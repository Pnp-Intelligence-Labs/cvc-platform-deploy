"""
enrichment plugin routes
========================
Prefix: /enrichment  (set by plugin_loader from manifest.json)

Company enrichment pipeline: quickadd by URL, 4D classification,
industrial scoring, DD pipeline management, intel suggestion review,
and activity log.
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks, Query
from fastapi.responses import FileResponse
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from pathlib import Path
import html as html_lib
import json
import logging
import os
import re

from core.db.connection import get_connection
from api.auth import require_auth

_qa_log = logging.getLogger("quickadd")
_dd_log = logging.getLogger("dd_pipeline")

# ── Repo root — prefer explicit env var so install path doesn't matter ─────────
# When installed as a plugin the file lives at:
#   <repo>/plugins/installed/enrichment/routes.py  → parents[3] = repo root
_REPO_ROOT = Path(os.environ.get("PLATFORM_ROOT", str(Path(__file__).resolve().parents[3])))

# DD workdir — files placed here are picked up by the DD pipeline
DD_WORKDIR = _REPO_ROOT / "workers" / "dd" / "workdir"
_DD_DIR    = _REPO_ROOT / "workers" / "dd"

# ── Team sector config ─────────────────────────────────────────────────────────
_TEAM_CONFIG_PATH = _REPO_ROOT / "config" / "team.json"
_FALLBACK_SECTORS = ["Robotics", "Supply Chain", "Industrial Automation",
                     "Physical AI", "Manufacturing", "Other"]
try:
    with open(_TEAM_CONFIG_PATH) as _f:
        _team_cfg = json.load(_f)
    _loaded_sectors = _team_cfg.get("sectors", [])
    _QA_VALID_SECTORS = _loaded_sectors if _loaded_sectors else _FALLBACK_SECTORS
except Exception:
    _QA_VALID_SECTORS = _FALLBACK_SECTORS


def _run_dd_pipeline(company_id: int, company_name: str) -> None:
    """Background task: run the full DD pipeline directly (no agent approval needed)."""
    import subprocess

    env = os.environ.copy()
    env["PYTHONPATH"] = str(_REPO_ROOT / "core")

    _dd_log.info(f"DD pipeline starting — {company_name} (id={company_id})")
    try:
        result = subprocess.run(
            ["python3", "run_three.py", "--company", company_name],
            cwd=str(_DD_DIR),
            env=env,
            timeout=10800,  # 3-hour ceiling
        )
        if result.returncode == 0:
            _dd_log.info(f"DD pipeline complete — {company_name}")
        else:
            _dd_log.error(f"DD pipeline exited with code {result.returncode} — {company_name}")
    except subprocess.TimeoutExpired:
        _dd_log.error(f"DD pipeline timed out after 3h — {company_name}")
    except Exception as e:
        _dd_log.error(f"DD pipeline error — {company_name}: {e}")

router = APIRouter()

# ── Quick Add by URL helpers ──────────────────────────────────────────────────

_QA_VALID_STAGES  = ["Seed", "Series A", "Series B", "Series C", "Growth", "Public", "Unknown"]
_QA_MODEL         = "qwen/qwen3-235b-a22b-2507"


def _scrape_site(url: str) -> tuple[str, str]:
    """
    Fetch a company website and extract name + useful text context.
    Returns (company_name, context_text). Falls back gracefully on errors.
    """
    import requests as _req
    try:
        resp = _req.get(
            url,
            timeout=12,
            headers={"User-Agent": "Mozilla/5.0 (compatible; PlatformBot/1.0)"},
            allow_redirects=True,
        )
        resp.raise_for_status()
        raw = resp.text
    except Exception as e:
        _qa_log.warning(f"scrape failed for {url}: {e}")
        return "", ""

    def _meta(pattern: str) -> str:
        m = re.search(pattern, raw, re.I | re.S)
        return html_lib.unescape(m.group(1).strip()) if m else ""

    title    = _meta(r'<title[^>]*>([^<]{1,200})</title>')
    og_title = _meta(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']')
    og_desc  = _meta(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']')
    meta_desc = _meta(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']')
    if not meta_desc:
        meta_desc = _meta(r'<meta[^>]+content=["\'](.*?)["\'][^>]+name=["\']description["\']')

    # Strip scripts/styles, then all tags, to get visible body text
    body = re.sub(r'<(script|style|noscript)[^>]*>.*?</(script|style|noscript)>', ' ', raw, flags=re.I | re.S)
    body = re.sub(r'<[^>]+>', ' ', body)
    body = re.sub(r'\s+', ' ', html_lib.unescape(body)).strip()[:4000]

    # Best guess at company name from page metadata
    raw_name = og_title or title or ""
    # Strip generic page-title suffixes: "Acme | Home", "Acme — Official Site"
    name = re.sub(r'\s*[\|—\-–]\s*(Home|Official|Website|Inc\.?|LLC\.?|Corp\.?|Welcome|About).*$', '', raw_name, flags=re.I).strip()
    # If it's still "Home | Acme" style, flip it
    if re.match(r'^(Home|Welcome|About)\s*[\|—\-–]', name, re.I):
        parts = re.split(r'[\|—\-–]', raw_name, maxsplit=1)
        name = parts[-1].strip() if len(parts) > 1 else name

    context = "\n\n".join(filter(None, [
        f"Title: {title}"                       if title    else "",
        f"OG Title: {og_title}"                 if og_title and og_title != title else "",
        f"Meta description: {og_desc or meta_desc}" if (og_desc or meta_desc) else "",
        f"Page text:\n{body}"                   if body     else "",
    ]))

    return name, context


def _build_quickadd_prompt(url: str, inferred_name: str, context: str) -> str:
    sectors_list = ", ".join(_QA_VALID_SECTORS)
    return f"""You are extracting structured company data from a website.

URL: {url}
Inferred company name (from page title): {inferred_name or "(unknown)"}

Website content:
{context or "(no content scraped)"}

Extract the following fields. Return ONLY a valid JSON object — no markdown, no explanation.

Fields:
- name: Official company name (correct the inferred name if it looks wrong)
- one_liner: One crisp sentence — what the company does and for whom
- description: 2-3 sentence overview of products, market, and differentiation
- sector: One of: {sectors_list}
- stage: One of: Seed, Series A, Series B, Series C, Growth, Public, Unknown
- hq_city: City where headquarters is located
- country: Country of headquarters (2-letter ISO code, e.g. US, UK, DE)
- employee_count: Integer estimate (omit if unknown)
- founded: 4-digit year founded (omit if unknown)

Omit any field you cannot determine with reasonable confidence.

JSON:"""


def _parse_quickadd_response(response: str) -> dict:
    """Parse LLM JSON response for quickadd enrichment."""
    try:
        text = response.strip()
        if "```" in text:
            m = re.search(r'```(?:json)?\s*([\s\S]+?)```', text)
            text = m.group(1).strip() if m else text
        data = json.loads(text)
    except Exception:
        # Last-ditch: grab first {...} block
        m = re.search(r'\{[\s\S]+\}', response)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except Exception:
            return {}

    result = {}
    str_fields = ("name", "one_liner", "description", "hq_city", "country")
    for f in str_fields:
        if data.get(f):
            result[f] = str(data[f]).strip()

    if data.get("sector") in _QA_VALID_SECTORS:
        result["sector"] = data["sector"]
    if data.get("stage") in _QA_VALID_STAGES and data["stage"] != "Unknown":
        result["stage"] = data["stage"]
    if data.get("employee_count"):
        try:
            result["employee_count"] = int(data["employee_count"])
        except (ValueError, TypeError):
            pass
    if data.get("founded"):
        try:
            yr = int(data["founded"])
            if 1800 <= yr <= 2030:
                result["founded"] = yr
        except (ValueError, TypeError):
            pass

    return result


def _run_quickadd_enrichment(company_id: int, url: str, context: str) -> None:
    """Background task: run LLM enrichment on a quickadd company."""
    try:
        from core.llm.openrouter import call as llm_call

        # Scrape now if context wasn't captured at request time (re-enrichment path)
        if not context:
            _, context = _scrape_site(url)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT name FROM cvc.companies WHERE id = %s", (company_id,))
                row = cur.fetchone()
        if not row:
            return

        prompt   = _build_quickadd_prompt(url, row["name"], context)
        response = llm_call(prompt, model=_QA_MODEL, activity="Quick Add")

        if not response:
            raise ValueError("empty LLM response")

        updates = _parse_quickadd_response(response)
        if not updates:
            raise ValueError("no fields extracted from LLM response")

        set_parts = [f"{k} = %s" for k in updates]
        params    = list(updates.values())
        set_parts += ["enrichment_status = 'pending'", "enrichment_source = 'quickadd'", "updated_at = NOW()"]
        params.append(company_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE cvc.companies SET {', '.join(set_parts)} WHERE id = %s",
                    params
                )
                cur.execute("""
                    UPDATE cvc.companies
                    SET search_text = to_tsvector(
                        coalesce(name,'') || ' ' ||
                        coalesce(one_liner,'') || ' ' ||
                        coalesce(description,'')
                    )
                    WHERE id = %s
                """, (company_id,))

        _qa_log.info(f"quickadd complete — company_id={company_id}, fields={list(updates.keys())}")

    except Exception as exc:
        _qa_log.error(f"quickadd failed — company_id={company_id}: {exc}")
        try:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE cvc.companies SET enrichment_status = 'failed', updated_at = NOW() WHERE id = %s",
                        (company_id,)
                    )
        except Exception:
            pass


class EnrichmentQueueItem(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    sector: Optional[str] = None
    stage: Optional[str] = None
    predicted_subsector: Optional[str] = None
    enrichment_confidence: Optional[float] = None
    enrichment_status: str


class ManualUpdateRequest(BaseModel):
    subsector: Optional[str] = None
    sector: Optional[str] = None
    stage: Optional[str] = None


class EnrichmentStats(BaseModel):
    auto_filled: int
    manual_review: int
    needs_research: int
    pending: int
    total: int
    missing_4d: int = 0
    has_4d: int = 0
    industrial_total: int = 0
    industrial_scored: int = 0


class AddCompanyRequest(BaseModel):
    name: str
    website: Optional[str] = None
    company_id: Optional[int] = None  # if set, attach to existing record instead of name-matching
    run_4d: bool = False
    run_industrial: bool = False
    run_dd: bool = False
    run_funding: bool = False
    run_news: bool = False
    run_founder: bool = False
    notes: Optional[str] = None       # e.g. news URLs, context — stored on the build task


class QuickAddRequest(BaseModel):
    url: str   # company website URL


@router.post("/quickadd")
async def quickadd_company(
    data: QuickAddRequest,
    background_tasks: BackgroundTasks,
    user=Depends(require_auth),
):
    """
    Quick Add by URL — paste a company website and enrich immediately.

    Flow:
    1. Normalize + validate URL.
    2. Dedup by website field (returns existing company if already in DB).
    3. Scrape the homepage to extract name + page context.
    4. Create company with enrichment_status='enriching', enrichment_source='quickadd'.
    5. Kick off background LLM enrichment — updates status to 'enriched' or 'failed'.
    6. Return company_id + name immediately (don't wait for enrichment).
    """
    url = data.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    url = url.rstrip("/")

    # Dedup: if a company with this website already exists, re-enrich it
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, enrichment_status FROM cvc.companies WHERE website = %s LIMIT 1",
                (url,)
            )
            existing = cur.fetchone()

    if existing:
        company_id = existing["id"]
        name       = existing["name"]
        existed    = True
        context    = ""   # will be re-scraped inside the background task
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE cvc.companies SET enrichment_status = 'enriching', updated_at = NOW() WHERE id = %s",
                    (company_id,)
                )
    else:
        # Scrape now — we need a name to create the DB record
        name, context = _scrape_site(url)
        if not name:
            # Fall back to domain name as placeholder
            m = re.search(r'https?://(?:www\.)?([^/]+)', url)
            name = m.group(1).split(".")[0].title() if m else "Unknown Company"

        with get_connection() as conn:
            with conn.cursor() as cur:
                # Second dedup by name in case URL differs
                cur.execute(
                    "SELECT id FROM cvc.companies WHERE lower(name) = lower(%s) LIMIT 1",
                    (name,)
                )
                row = cur.fetchone()
                if row:
                    company_id = row["id"]
                    existed    = True
                    cur.execute(
                        "UPDATE cvc.companies SET website = %s, enrichment_status = 'enriching', updated_at = NOW() WHERE id = %s",
                        (url, company_id)
                    )
                else:
                    cur.execute("""
                        INSERT INTO cvc.companies
                            (name, website, enrichment_status, enrichment_source, created_at, updated_at)
                        VALUES (%s, %s, 'enriching', 'quickadd', NOW(), NOW())
                        RETURNING id
                    """, (name, url))
                    company_id = cur.fetchone()["id"]
                    existed    = False

    background_tasks.add_task(_run_quickadd_enrichment, company_id, url, context)

    return {"company_id": company_id, "name": name, "existed": existed, "status": "enriching"}


@router.post("/add-company")
async def add_company_to_queue(data: AddCompanyRequest, user=Depends(require_auth)):
    """Add a company and queue selected enrichment jobs.

    If company_id is provided the existing record is used directly (no name lookup).
    Otherwise falls back to case-insensitive name match, then insert if not found.
    """
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Company name is required")

    username = user.get("username", "platform") if isinstance(user, dict) else str(user)

    with get_connection() as conn:
        with conn.cursor() as cur:
            if data.company_id:
                # Attach to a specific existing company
                cur.execute("SELECT id, name FROM cvc.companies WHERE id = %s", (data.company_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Company not found")
                company_id = row["id"]
                name = row["name"]  # use canonical name for task specs
                existed = True
                if data.website:
                    cur.execute(
                        "UPDATE cvc.companies SET website = %s, updated_at = NOW() WHERE id = %s",
                        (data.website, company_id)
                    )
                else:
                    cur.execute("UPDATE cvc.companies SET updated_at = NOW() WHERE id = %s", (company_id,))
            else:
                # Fall back to name match, then insert
                cur.execute(
                    "SELECT id FROM cvc.companies WHERE lower(name) = lower(%s) LIMIT 1",
                    (name,)
                )
                row = cur.fetchone()
                if row:
                    company_id = row["id"]
                    existed = True
                    if data.website:
                        cur.execute(
                            "UPDATE cvc.companies SET website = %s, updated_at = NOW() WHERE id = %s",
                            (data.website, company_id)
                        )
                    else:
                        cur.execute("UPDATE cvc.companies SET updated_at = NOW() WHERE id = %s", (company_id,))
                else:
                    cur.execute("""
                        INSERT INTO cvc.companies (name, website, enrichment_status, created_at, updated_at)
                        VALUES (%s, %s, 'pending', NOW(), NOW())
                        RETURNING id
                    """, (name, data.website or None))
                    company_id = cur.fetchone()["id"]
                    existed = False

            fourd_task_id = None
            if data.run_4d:
                spec = (
                    f"Run 4D classification for {name} (company_id={company_id}). "
                    f"Command: cd {_REPO_ROOT} && "
                    f"PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_4d.py --id={company_id} --no-gate"
                )
                cur.execute("""
                    INSERT INTO cvc.build_tasks
                        (spec, priority, risk_level, requires_approval, status, created_by, assigned_to, task_type, notes, status_changed_at)
                    VALUES (%s, 'medium', 'low', FALSE, 'pending', %s, 'bigclaw', 'enrichment', %s, NOW())
                    RETURNING task_id
                """, (spec, username, data.notes))
                fourd_task_id = cur.fetchone()["task_id"]

            industrial_task_id = None
            if data.run_industrial:
                spec = (
                    f"Run industrial enrichment for {name} (company_id={company_id}). "
                    f"Command: cd {_REPO_ROOT} && "
                    f"PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_industrial.py --company \"{name}\""
                )
                cur.execute("""
                    INSERT INTO cvc.build_tasks
                        (spec, priority, risk_level, requires_approval, status, created_by, assigned_to, task_type, notes, status_changed_at)
                    VALUES (%s, 'medium', 'low', FALSE, 'pending', %s, 'bigclaw', 'enrichment', %s, NOW())
                    RETURNING task_id
                """, (spec, username, data.notes))
                industrial_task_id = cur.fetchone()["task_id"]

            funding_task_id = None
            if data.run_funding:
                spec = (
                    f"Run funding round enrichment for {name} (company_id={company_id}). "
                    f"Command: cd {_REPO_ROOT} && "
                    f"PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_funding_rounds.py --company-id={company_id} --batch"
                )
                cur.execute("""
                    INSERT INTO cvc.build_tasks
                        (spec, priority, risk_level, requires_approval, status, created_by, assigned_to, task_type, notes, status_changed_at)
                    VALUES (%s, 'medium', 'low', FALSE, 'pending', %s, 'bigclaw', 'enrichment', %s, NOW())
                    RETURNING task_id
                """, (spec, username, data.notes))
                funding_task_id = cur.fetchone()["task_id"]

            news_task_id = None
            if data.run_news:
                spec = (
                    f"Run case studies & revenue enrichment for {name} (company_id={company_id}). "
                    f"Command: cd {_REPO_ROOT} && "
                    f"PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_cases.py --id={company_id} --no-gate"
                )
                cur.execute("""
                    INSERT INTO cvc.build_tasks
                        (spec, priority, risk_level, requires_approval, status, created_by, assigned_to, task_type, notes, status_changed_at)
                    VALUES (%s, 'medium', 'low', FALSE, 'pending', %s, 'bigclaw', 'enrichment', %s, NOW())
                    RETURNING task_id
                """, (spec, username, data.notes))
                news_task_id = cur.fetchone()["task_id"]

            founder_task_id = None
            if data.run_founder:
                spec = (
                    f"Run founder research enrichment for {name} (company_id={company_id}). "
                    f"Command: cd {_REPO_ROOT} && "
                    f"PYTHONPATH=core venv/bin/python3 workers/enrichment/founder_research.py --company-id={company_id}"
                )
                cur.execute("""
                    INSERT INTO cvc.build_tasks
                        (spec, priority, risk_level, requires_approval, status, created_by, assigned_to, task_type, notes, status_changed_at)
                    VALUES (%s, 'medium', 'low', FALSE, 'pending', %s, 'bigclaw', 'enrichment', %s, NOW())
                    RETURNING task_id
                """, (spec, username, data.notes))
                founder_task_id = cur.fetchone()["task_id"]

            dd_task_id = None
            if data.run_dd:
                # Set lifecycle status — pipeline is triggered separately via /dd/{id}/trigger
                cur.execute("""
                    INSERT INTO cvc.company_lifecycle
                        (company_id, status, status_changed_at, changed_by, reason)
                    VALUES (%s, 'due_diligence', NOW(), %s, 'DD queued from Enrichment Queue')
                    ON CONFLICT (company_id) DO UPDATE SET
                        status = 'due_diligence',
                        status_changed_at = NOW(),
                        changed_by = %s,
                        reason = 'DD queued from Enrichment Queue'
                """, (company_id, username, username))
                dd_task_id = "queued"

            return {
                "company_id": company_id,
                "existed": existed,
                "fourd_task_id": fourd_task_id,
                "industrial_task_id": industrial_task_id,
                "funding_task_id": funding_task_id,
                "news_task_id": news_task_id,
                "dd_task_id": dd_task_id,
            }


@router.get("/requests")
async def get_enrichment_requests(user=Depends(require_auth)):
    """All enrichment submissions: Industrial and DD build tasks, plus 4D pending companies.

    Returns a unified list ordered by most recent first.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Industrial + DD build tasks — extract company_id from spec with regex
            cur.execute("""
                SELECT
                    bt.task_id,
                    bt.status,
                    bt.created_at,
                    bt.task_type,
                    bt.spec,
                    CASE
                        WHEN bt.spec ILIKE '%industrial enrichment%' THEN 'industrial'
                        WHEN bt.spec ILIKE '%DD pipeline%'           THEN 'dd'
                        ELSE 'other'
                    END AS enrichment_type,
                    -- extract company_id=N from spec
                    (regexp_match(bt.spec, 'company_id=(\d+)'))[1]::int AS company_id,
                    c.name  AS company_name,
                    c.sector
                FROM cvc.build_tasks bt
                LEFT JOIN cvc.companies c
                    ON c.id = (regexp_match(bt.spec, 'company_id=(\d+)'))[1]::int
                WHERE (bt.spec ILIKE '%industrial enrichment%'
                   OR bt.spec ILIKE '%DD pipeline%')
                  AND bt.status != 'superseded'
                ORDER BY bt.created_at DESC
                LIMIT 200
            """)
            tasks = cur.fetchall()

            # 4D: companies currently in pending enrichment status
            cur.execute("""
                SELECT
                    id          AS company_id,
                    name        AS company_name,
                    sector,
                    updated_at  AS created_at
                FROM cvc.companies
                WHERE enrichment_status = 'pending'
                ORDER BY updated_at DESC NULLS LAST
                LIMIT 200
            """)
            pending_4d = cur.fetchall()

            return {
                "tasks": [
                    {
                        "task_id":        r["task_id"],
                        "enrichment_type": r["enrichment_type"],
                        "company_id":     r["company_id"],
                        "company_name":   r["company_name"] or "Unknown",
                        "sector":         r["sector"],
                        "status":         r["status"],
                        "created_at":     r["created_at"].isoformat() if r["created_at"] else None,
                    }
                    for r in tasks
                ],
                "pending_4d": [
                    {
                        "company_id":   r["company_id"],
                        "company_name": r["company_name"],
                        "sector":       r["sector"],
                        "created_at":   r["created_at"].isoformat() if r["created_at"] else None,
                    }
                    for r in pending_4d
                ],
            }


class RequestEditPayload(BaseModel):
    priority: Optional[str] = None   # low | medium | high
    notes: Optional[str] = None


@router.delete("/requests/task/{task_id}")
async def delete_request_task(task_id: int, user=Depends(require_auth)):
    """Remove a DD/enrichment task from the Requests view by marking it superseded."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.build_tasks
                SET status = 'superseded', status_changed_at = NOW()
                WHERE task_id = %s
            """, (task_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Task not found")
            return {"deleted": task_id}


@router.delete("/requests/4d/{company_id}")
async def delete_request_4d(company_id: int, user=Depends(require_auth)):
    """Remove a 4D-pending company from the Requests view."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.companies
                SET enrichment_status = NULL, updated_at = NOW()
                WHERE id = %s AND enrichment_status = 'pending'
            """, (company_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Company not found or not pending")
            return {"deleted": company_id}


@router.patch("/requests/task/{task_id}")
async def edit_request_task(task_id: int, data: RequestEditPayload, user=Depends(require_auth)):
    """Edit priority or notes on a DD/enrichment task."""
    if data.priority and data.priority not in ('low', 'medium', 'high'):
        raise HTTPException(status_code=400, detail="priority must be low, medium, or high")
    with get_connection() as conn:
        with conn.cursor() as cur:
            updates, params = [], []
            if data.priority:
                updates.append("priority = %s"); params.append(data.priority)
            if data.notes is not None:
                updates.append("notes = %s"); params.append(data.notes)
            if not updates:
                raise HTTPException(status_code=400, detail="Nothing to update")
            params.append(task_id)
            cur.execute(
                f"UPDATE cvc.build_tasks SET {', '.join(updates)} WHERE task_id = %s AND task_type IN ('dd', 'enrichment')",
                params,
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Task not found")
            return {"updated": task_id}


def _get_company_name(company_id: int) -> str:
    """Resolve company_id → name, raise 404 if missing."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM cvc.companies WHERE id = %s", (company_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")
            return row["name"]


AGENTS = ["financials", "comp", "qualitative", "product", "news", "generalist"]


@router.get("/dd/{company_id}/status")
async def get_dd_status(company_id: int, user=Depends(require_auth)):
    """Pipeline stage completion derived from files present in workdir."""
    company_name = _get_company_name(company_id)
    base = DD_WORKDIR / company_name

    if not base.exists():
        return {"status": "not_started", "company_name": company_name, "stages": {}}

    def exists(rel: str) -> bool:
        return (base / rel).exists()

    agent_stages = {a: exists(f"agents/{a}.json") for a in AGENTS}
    has_manifest  = exists("manifest.json")
    has_overview  = exists("overview.json")
    has_appendix  = exists("appendix.json")
    has_memo      = any(base.glob("*_IC_Memo.pdf"))
    has_apx_pdf   = any(base.glob("*_Appendix.pdf"))
    has_scorecard = any(base.glob("*_Scorecard.xlsx"))
    outputs_ready = has_memo and has_apx_pdf and has_scorecard

    if outputs_ready or has_overview:
        overall = "complete"
    elif has_manifest and any(agent_stages.values()):
        overall = "running"
    elif has_manifest:
        overall = "ingested"
    else:
        overall = "not_started"

    return {
        "status":       overall,
        "company_name": company_name,
        "stages": {
            "ingestion":  has_manifest,
            "agents":     agent_stages,
            "overview":   has_overview,
            "appendix":   has_appendix,
            "outputs": {
                "ic_memo":   has_memo,
                "appendix":  has_apx_pdf,
                "scorecard": has_scorecard,
            },
        },
    }


@router.get("/dd/{company_id}/manifest")
async def get_dd_manifest(company_id: int, user=Depends(require_auth)):
    """Return ingestion manifest: doc counts, types, routing."""
    company_name = _get_company_name(company_id)
    path = DD_WORKDIR / company_name / "manifest.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Manifest not found — pipeline not yet run")
    data = json.loads(path.read_text())
    return {
        "company_name": company_name,
        "date":         data.get("date"),
        "summary":      data.get("summary", {}),
        "routing":      {
            agent: len(docs)
            for agent, docs in data.get("routing", {}).items()
        },
    }


@router.get("/dd/{company_id}/agents")
async def get_dd_agents(company_id: int, user=Depends(require_auth)):
    """Return summary for all completed agent runs."""
    company_name = _get_company_name(company_id)
    base = DD_WORKDIR / company_name / "agents"
    result = []
    for agent in AGENTS:
        path = base / f"{agent}.json"
        if not path.exists():
            result.append({"agent": agent, "status": "pending"})
            continue
        data = json.loads(path.read_text())
        result.append({
            "agent":          agent,
            "status":         data.get("status", "unknown"),
            "summary":        data.get("summary", ""),
            "findings_count": len(data.get("findings", [])),
            "flags_count":    len(data.get("flags", [])),
            "flags":          data.get("flags", [])[:5],   # top 5 flags
        })
    return {"company_name": company_name, "agents": result}


@router.get("/dd/{company_id}/agent/{agent_name}")
async def get_dd_agent(company_id: int, agent_name: str, user=Depends(require_auth)):
    """Return full output for a single agent."""
    if agent_name not in AGENTS:
        raise HTTPException(status_code=400, detail=f"Unknown agent. Valid: {', '.join(AGENTS)}")
    company_name = _get_company_name(company_id)
    path = DD_WORKDIR / company_name / "agents" / f"{agent_name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{agent_name} has not run yet")
    return json.loads(path.read_text())


@router.get("/dd/{company_id}/overview")
async def get_dd_overview(company_id: int, user=Depends(require_auth)):
    """Return overview.json: IC memo narrative, recommendation, scorecard, flags."""
    company_name = _get_company_name(company_id)
    path = DD_WORKDIR / company_name / "overview.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Overview not ready yet")
    data = json.loads(path.read_text())
    return {
        "company_name":            company_name,
        "recommendation":          data.get("recommendation"),
        "recommendation_rationale": data.get("recommendation_rationale"),
        "one_liner":               data.get("one_liner"),
        "investment_thesis":       data.get("investment_thesis"),
        "section_summaries":       data.get("section_summaries", {}),
        "key_metrics":             data.get("key_metrics", {}),
        "ic_questions":            data.get("ic_questions", []),
        "all_flags":               data.get("all_flags", []),
        "scorecard":               data.get("scorecard", {}),
        "cross_agent_signals":     data.get("cross_agent_signals", []),
        "stage":                   data.get("stage"),
        "raise_amount":            data.get("raise_amount"),
        "summary":                 data.get("summary"),
    }


@router.get("/dd/{company_id}/download/{filename}")
async def download_dd_file(company_id: int, filename: str, user=Depends(require_auth)):
    """Serve IC Memo PDF, Appendix PDF, Scorecard XLSX, or Review Memo PDF/DOCX as a download."""
    # Whitelist extensions to prevent path traversal
    allowed_suffixes = {".pdf", ".xlsx", ".docx"}
    suffix = Path(filename).suffix.lower()
    if suffix not in allowed_suffixes:
        raise HTTPException(status_code=400, detail="Only PDF, XLSX, and DOCX downloads are supported")
    # Strip any path components from filename
    safe_name = Path(filename).name
    company_name = _get_company_name(company_id)
    path = DD_WORKDIR / company_name / safe_name
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{safe_name} not found")
    media_map = {
        ".pdf":  "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    return FileResponse(path=str(path), filename=safe_name, media_type=media_map[suffix])


class DDOverviewEdit(BaseModel):
    recommendation: Optional[str] = None   # invest | conditional | watch | pass
    recommendation_rationale: Optional[str] = None


@router.patch("/dd/{company_id}/overview")
async def patch_dd_overview(company_id: int, data: DDOverviewEdit, user=Depends(require_auth)):
    """Update recommendation and/or rationale in the company's overview.json."""
    valid_recos = {"invest", "conditional", "watch", "pass"}
    if data.recommendation and data.recommendation.lower() not in valid_recos:
        raise HTTPException(status_code=400, detail=f"recommendation must be one of: {', '.join(valid_recos)}")
    company_name = _get_company_name(company_id)
    path = DD_WORKDIR / company_name / "overview.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="overview.json not found — DD not yet complete")
    overview = json.loads(path.read_text())
    if data.recommendation is not None:
        overview["recommendation"] = data.recommendation.lower()
    if data.recommendation_rationale is not None:
        overview["recommendation_rationale"] = data.recommendation_rationale
    path.write_text(json.dumps(overview, indent=2))
    return {"updated": True, "company_name": company_name, "recommendation": overview.get("recommendation")}


@router.delete("/dd/{company_id}")
async def delete_dd_run(company_id: int, user=Depends(require_auth)):
    """Delete all DD output files for a company (wipes workdir). Resets lifecycle status."""
    import shutil
    username = user.get("username", "platform") if isinstance(user, dict) else str(user)
    company_name = _get_company_name(company_id)
    workdir = DD_WORKDIR / company_name
    if not workdir.exists():
        raise HTTPException(status_code=404, detail="No DD run found for this company")
    shutil.rmtree(str(workdir))
    # Reset lifecycle status away from dd_active if it was set
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.company_lifecycle
                SET status = 'discovered', status_changed_at = NOW(), changed_by = %s,
                    reason = 'DD run deleted via profile page'
                WHERE company_id = %s AND status = 'due_diligence'
            """, (username, company_id))
    return {"deleted": True, "company_name": company_name}


@router.post("/enrich-batch")
async def trigger_enrich_batch(
    limit: int = 10,
    user=Depends(require_auth)
):
    """
    Trigger batch enrichment via script. Returns job info.
    """
    import subprocess
    import sys

    script_path = _REPO_ROOT / "scripts" / "enrich_company_data.py"

    if not script_path.exists():
        raise HTTPException(status_code=500, detail=f"Enrichment script not found at {script_path}")

    try:
        result = subprocess.run(
            [sys.executable, str(script_path), "--limit", str(limit)],
            capture_output=True,
            text=True,
            timeout=300,
            cwd=str(_REPO_ROOT),
        )
        return {
            "status": "completed",
            "limit": limit,
            "stdout": result.stdout[-2000:] if result.stdout else "",
            "stderr": result.stderr[-500:] if result.stderr else ""
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Enrichment batch timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Enrichment failed: {str(e)}")


@router.get("/enrichment-queue", response_model=List[EnrichmentQueueItem])
async def get_enrichment_queue(
    status: Optional[str] = None,
    limit: int = 50,
    user=Depends(require_auth)
):
    """Get companies flagged for manual review or other statuses."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if status:
                cur.execute("""
                    SELECT id, name, description, sector, stage,
                           predicted_subsector, enrichment_confidence, enrichment_status
                    FROM cvc.companies
                    WHERE enrichment_status = %s
                    ORDER BY enrichment_confidence DESC NULLS LAST, name
                    LIMIT %s
                """, (status, limit))
            else:
                cur.execute("""
                    SELECT id, name, description, sector, stage,
                           predicted_subsector, enrichment_confidence, enrichment_status
                    FROM cvc.companies
                    WHERE enrichment_status IN ('manual_review', 'needs_research')
                    ORDER BY enrichment_confidence DESC NULLS LAST, name
                    LIMIT %s
                """, (limit,))

            rows = cur.fetchall()
            return [
                EnrichmentQueueItem(
                    id=r["id"],
                    name=r["name"],
                    description=r["description"][:200] + "..." if r["description"] and len(r["description"]) > 200 else r["description"],
                    sector=r["sector"],
                    stage=r["stage"],
                    predicted_subsector=r["predicted_subsector"],
                    enrichment_confidence=r["enrichment_confidence"],
                    enrichment_status=r["enrichment_status"]
                ) for r in rows
            ]


@router.post("/enrichment-queue/{company_id}/approve")
async def approve_prediction(
    company_id: int,
    user=Depends(require_auth)
):
    """Accept the predicted subsector and apply it."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT predicted_subsector FROM cvc.companies WHERE id = %s",
                (company_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")

            predicted = row["predicted_subsector"]
            if not predicted:
                raise HTTPException(status_code=400, detail="No prediction to approve")

            cur.execute("""
                UPDATE cvc.companies
                SET subsector = predicted_subsector,
                    enrichment_status = 'approved',
                    enrichment_source = 'manual_approval'
                WHERE id = %s
            """, (company_id,))

            return {
                "status": "approved",
                "company_id": company_id,
                "applied_subsector": predicted
            }


@router.post("/enrichment-queue/{company_id}/update")
async def manual_update(
    company_id: int,
    data: ManualUpdateRequest,
    user=Depends(require_auth)
):
    """Manually override prediction with corrected values."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            updates = []
            params = []

            if data.subsector is not None:
                updates.append("subsector = %s")
                params.append(data.subsector)

            if data.sector is not None:
                updates.append("sector = %s")
                params.append(data.sector)

            if data.stage is not None:
                updates.append("stage = %s")
                params.append(data.stage)

            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update")

            updates.append("enrichment_status = %s")
            params.append('manual_override')
            updates.append("enrichment_source = %s")
            params.append('manual_edit')
            params.append(company_id)

            query = f"UPDATE cvc.companies SET {', '.join(updates)} WHERE id = %s"
            cur.execute(query, params)

            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Company not found")

            return {
                "status": "updated",
                "company_id": company_id,
                "updates": data.dict(exclude_none=True)
            }


@router.get("/enrichment-realstats")
async def get_enrichment_realstats(user=Depends(require_auth)):
    """Real enrichment status counts from actual DB values."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE enrichment_status = 'enriched') as enriched,
                    COUNT(*) FILTER (WHERE enrichment_status IN ('pending', 'enriching') OR enrichment_status IS NULL) as pending,
                    COUNT(*) FILTER (WHERE enrichment_status = 'failed') as failed,
                    COUNT(*) as total
                FROM cvc.companies
            """)
            row = cur.fetchone()
            return {
                "enriched": row["enriched"],
                "pending": row["pending"],
                "failed": row["failed"],
                "total": row["total"],
            }


@router.get("/enrichment-list")
async def get_enrichment_list(
    status: str = "pending",
    limit: int = 100,
    user=Depends(require_auth)
):
    """Return companies by enrichment status with key fields and enrichment type flags."""
    dd_complete_ids: set[int] = set()
    dd_review_ids:   set[int] = set()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT company_id, name FROM cvc.company_lifecycle cl JOIN cvc.companies c ON c.id = cl.company_id")
            for lrow in cur.fetchall():
                cid, cname = lrow["company_id"], lrow["name"]
                workdir = DD_WORKDIR / cname
                has_memo      = any(workdir.glob("*_IC_Memo.pdf"))
                has_apx_pdf   = any(workdir.glob("*_Appendix.pdf"))
                has_scorecard = any(workdir.glob("*_Scorecard.xlsx"))
                if has_memo and has_apx_pdf and has_scorecard:
                    dd_complete_ids.add(cid)
                if any(workdir.glob("*_Review_Memo.pdf")) or any(workdir.glob("*_Review_Memo.docx")):
                    dd_review_ids.add(cid)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.id, c.name, c.sector, c.stage, c.website, c.enrichment_status,
                       c.enrichment_confidence, c.updated_at,
                       (c.func_4d IS NOT NULL)                                               AS has_4d,
                       (c.score_irs IS NOT NULL OR c.industrial_readiness_score IS NOT NULL) AS has_industrial
                FROM cvc.companies c
                WHERE (
                    CASE WHEN %s = 'pending'
                         THEN c.enrichment_status IN ('pending', 'enriching') OR c.enrichment_status IS NULL
                         ELSE c.enrichment_status = %s
                    END
                )
                ORDER BY c.updated_at DESC NULLS LAST, c.name
                LIMIT %s
            """, (status, status, limit))
            rows = cur.fetchall()
            return [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "sector": r["sector"],
                    "stage": r["stage"],
                    "website": r["website"],
                    "enrichment_status": r["enrichment_status"],
                    "enrichment_confidence": r["enrichment_confidence"],
                    "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
                    "has_4d": r["has_4d"],
                    "has_industrial": r["has_industrial"],
                    "has_dd":     r["id"] in dd_complete_ids,
                    "has_review": r["id"] in dd_review_ids,
                }
                for r in rows
            ]


class PendingCompanyEdit(BaseModel):
    name: Optional[str] = None
    website: Optional[str] = None
    sector: Optional[str] = None
    stage: Optional[str] = None


@router.patch("/enrichment-pending/{company_id}")
async def edit_pending_company(company_id: int, data: PendingCompanyEdit, user=Depends(require_auth)):
    """Update editable fields on a pending company."""
    fields, vals = [], []
    if data.name    is not None: fields.append("name = %s");    vals.append(data.name.strip())
    if data.website is not None: fields.append("website = %s"); vals.append(data.website.strip() or None)
    if data.sector  is not None: fields.append("sector = %s");  vals.append(data.sector.strip() or None)
    if data.stage   is not None: fields.append("stage = %s");   vals.append(data.stage.strip() or None)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    vals.append(company_id)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.companies SET {', '.join(fields)}, updated_at = NOW() WHERE id = %s AND enrichment_status = 'pending'",
                vals
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Company not found or not in pending state")
    return {"updated": True, "company_id": company_id}


@router.delete("/enrichment-pending/{company_id}")
async def remove_pending_company(company_id: int, user=Depends(require_auth)):
    """Remove a company from the pending queue and clear its deal pipeline lifecycle entry."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.companies
                SET enrichment_status = NULL, updated_at = NOW()
                WHERE id = %s AND enrichment_status = 'pending'
            """, (company_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Company not found or not in pending state")
            # Also remove from deal pipeline so it doesn't linger there
            cur.execute("DELETE FROM cvc.company_lifecycle WHERE company_id = %s", (company_id,))
    return {"removed": True, "company_id": company_id}


@router.post("/enrichment-retry/{company_id}")
async def retry_enrichment(company_id: int, user=Depends(require_auth)):
    """Reset a failed company back to pending so the next cron picks it up."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.companies
                SET enrichment_status = 'pending', updated_at = NOW()
                WHERE id = %s AND enrichment_status = 'failed'
            """, (company_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Company not found or not in failed state")
            return {"status": "reset", "company_id": company_id}


@router.post("/dd/{company_id}/upload")
async def upload_dd_files(
    company_id: int,
    files: List[UploadFile] = File(...),
    user=Depends(require_auth),
):
    """Upload dataroom files for a company's DD workdir."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM cvc.companies WHERE id = %s", (company_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")
            company_name = row["name"]

    company_dir = DD_WORKDIR / company_name
    company_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for f in files:
        filename = Path(f.filename).name  # strip any path components
        dest = company_dir / filename
        content = await f.read()
        dest.write_bytes(content)
        saved.append({"name": filename, "size": len(content)})

    return {"saved": saved, "company_name": company_name}


@router.get("/dd/{company_id}/files")
async def list_dd_files(company_id: int, user=Depends(require_auth)):
    """List files currently staged in a company's DD workdir."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM cvc.companies WHERE id = %s", (company_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")
            company_name = row["name"]

    company_dir = DD_WORKDIR / company_name
    if not company_dir.exists():
        return {"files": [], "company_name": company_name}

    files = []
    for f in sorted(company_dir.iterdir()):
        if f.is_file() and not f.name.startswith("."):
            stat = f.stat()
            files.append({
                "name": f.name,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return {"files": files, "company_name": company_name}


class RoutingSavePayload(BaseModel):
    routing: dict  # { "doc_type_or_filename": ["financials", "comp", ...] }


@router.get("/dd/{company_id}/routing")
async def get_dd_routing(company_id: int, user=Depends(require_auth)):
    """Return per-group file routing for a company's DD workdir."""
    company_name = _get_company_name(company_id)
    base = DD_WORKDIR / company_name
    _AGENTS = ["financials", "comp", "qualitative", "product", "news", "generalist"]

    DOC_TYPE_LABELS = {
        "legal_formation": "Legal Formation",
        "patent_ip":       "Patents & IP",
        "legal_terms":     "Legal Terms / Contracts",
        "team_bio":        "Team Bios",
        "cap_table":       "Cap Table / Equity",
        "pitch_deck":      "Pitch Deck",
        "financial":       "Financial Statements",
        "unknown":         "Unclassified",
    }

    # Load routing override if it exists
    override_path = base / "routing_override.json"
    override: dict = {}
    if override_path.exists():
        try:
            override = json.loads(override_path.read_text())
        except Exception:
            pass

    manifest_path = base / "manifest.json"
    if not manifest_path.exists():
        if not base.exists():
            return {"company_name": company_name, "has_manifest": False, "has_override": bool(override), "groups": [], "files": []}
        root_files = [
            {"name": f.name, "size": f.stat().st_size, "agents": override.get(f.name, [])}
            for f in sorted(base.iterdir())
            if f.is_file() and not f.name.startswith(".")
            and f.suffix.lower() in {".pdf", ".docx", ".xlsx", ".csv", ".txt", ".zip"}
        ]
        return {"company_name": company_name, "has_manifest": False, "has_override": bool(override),
                "groups": [], "files": root_files}

    # Parse manifest — build doc_type → {files, agents} map
    manifest = json.loads(manifest_path.read_text())
    routing: dict = manifest.get("routing", {})  # agent → [doc objects]
    documents: list = manifest.get("documents", [])

    fn_to_type: dict = {d["filename"]: d.get("doc_type", "unknown") for d in documents}

    type_to_agents: dict = {}
    for agent, docs in routing.items():
        if agent not in _AGENTS:
            continue
        for doc in docs:
            fn = doc.get("filename", "")
            dt = fn_to_type.get(fn, "unknown")
            type_to_agents.setdefault(dt, set()).add(agent)

    type_counts: dict = {}
    for doc in documents:
        dt = doc.get("doc_type", "unknown")
        type_counts[dt] = type_counts.get(dt, 0) + 1

    groups = []
    for dt, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        base_agents = sorted(type_to_agents.get(dt, set()))
        active_agents = override.get(dt, base_agents)
        groups.append({
            "group":      dt,
            "label":      DOC_TYPE_LABELS.get(dt, dt.replace("_", " ").title()),
            "file_count": count,
            "agents":     active_agents,
            "default_agents": base_agents,
        })

    return {
        "company_name": company_name,
        "has_manifest": True,
        "has_override": bool(override),
        "groups": groups,
        "files": [],
    }


@router.post("/dd/{company_id}/routing")
async def save_dd_routing(company_id: int, data: RoutingSavePayload, user=Depends(require_auth)):
    """Save routing override for a company's DD workdir."""
    company_name = _get_company_name(company_id)
    base = DD_WORKDIR / company_name
    if not base.exists():
        raise HTTPException(status_code=404, detail="Workdir not found — upload files first")
    override_path = base / "routing_override.json"
    override_path.write_text(json.dumps(data.routing, indent=2))
    return {"saved": True, "company_name": company_name, "groups": len(data.routing)}


@router.delete("/dd/{company_id}/routing")
async def reset_dd_routing(company_id: int, user=Depends(require_auth)):
    """Remove routing override — reverts to manifest auto-routing."""
    company_name = _get_company_name(company_id)
    override_path = DD_WORKDIR / company_name / "routing_override.json"
    if not override_path.exists():
        raise HTTPException(status_code=404, detail="No routing override found")
    override_path.unlink()
    return {"reset": True, "company_name": company_name}


@router.post("/dd/{company_id}/trigger")
async def trigger_dd_action(
    company_id: int,
    background_tasks: BackgroundTasks,
    mode: str = "full",   # "full" | "research" | "ingest"
    user=Depends(require_auth),
):
    """Trigger a DD action for a company.

    full     — runs run_three.py immediately as a background task
    research — queues industrial enrichment via build_tasks
    ingest   — files already staged; confirms count and returns
    """
    username = user.get("username", "platform") if isinstance(user, dict) else str(user)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM cvc.companies WHERE id = %s", (company_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")
            company_name = row["name"]

            if mode == "full":
                cur.execute("""
                    INSERT INTO cvc.company_lifecycle
                        (company_id, status, status_changed_at, changed_by, reason)
                    VALUES (%s, 'due_diligence', NOW(), %s, 'DD triggered manually')
                    ON CONFLICT (company_id) DO UPDATE SET
                        status = 'due_diligence',
                        status_changed_at = NOW(),
                        changed_by = %s,
                        reason = 'DD triggered manually'
                """, (company_id, username, username))
                background_tasks.add_task(_run_dd_pipeline, company_id, company_name)
                return {"mode": "full", "company_name": company_name, "status": "running"}

            elif mode == "research":
                spec = (
                    f"Run industrial enrichment for {company_name} (company_id={company_id}). "
                    f"Command: cd {_REPO_ROOT} && "
                    f"PYTHONPATH=core venv/bin/python3 workers/enrichment/enrich_industrial.py "
                    f"--company \"{company_name}\""
                )
                cur.execute("""
                    INSERT INTO cvc.build_tasks
                        (spec, priority, risk_level, requires_approval, status,
                         created_by, assigned_to, task_type, status_changed_at)
                    VALUES (%s, 'medium', 'low', FALSE, 'pending',
                            %s, 'bigclaw', 'enrichment', NOW())
                    RETURNING task_id
                """, (spec, username))
                task_id = cur.fetchone()["task_id"]
                return {"task_id": task_id, "mode": "research", "company_name": company_name}

            elif mode == "ingest":
                company_dir = DD_WORKDIR / company_name
                file_count = sum(
                    1 for f in company_dir.iterdir()
                    if f.is_file() and not f.name.startswith(".")
                ) if company_dir.exists() else 0
                return {
                    "mode": "ingest",
                    "company_name": company_name,
                    "files_queued": file_count,
                }

            else:
                raise HTTPException(status_code=400, detail=f"Unknown mode: {mode}")


# ── Intel Suggestions (human review) ─────────────────────────────────────────

@router.get("/suggestions")
async def list_suggestions(
    suggestion_type: str = "new_funding_round,case_study",
    status: str = "pending",
    user=Depends(require_auth),
):
    """List intel suggestions pending human review. suggestion_type accepts comma-separated values."""
    types = [t.strip() for t in suggestion_type.split(",") if t.strip()]
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.company_id, c.name AS company_name, c.sector,
                       s.suggestion_type, s.suggested_data, s.confidence,
                       s.reasoning, s.status, s.created_at
                FROM cvc.intel_suggestions s
                JOIN cvc.companies c ON c.id = s.company_id
                WHERE s.suggestion_type = ANY(%s) AND s.status = %s
                ORDER BY s.confidence DESC, c.name
            """, (types, status))
            rows = cur.fetchall()
            return [
                {
                    "id": r["id"],
                    "company_id": r["company_id"],
                    "company_name": r["company_name"],
                    "sector": r["sector"],
                    "suggestion_type": r["suggestion_type"],
                    "suggested_data": r["suggested_data"],
                    "confidence": float(r["confidence"]) if r["confidence"] is not None else None,
                    "reasoning": r["reasoning"],
                    "status": r["status"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                }
                for r in rows
            ]


class ApproveBody(BaseModel):
    source_url: Optional[str] = None  # analyst-provided URL override


@router.post("/suggestions/{suggestion_id}/approve")
async def approve_suggestion(
    suggestion_id: int,
    body: ApproveBody = ApproveBody(),
    user=Depends(require_auth),
):
    """Approve an intel suggestion — writes to the appropriate table."""
    username = user.get("username", "platform") if isinstance(user, dict) else str(user)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.company_id, s.suggested_data, s.suggestion_type
                FROM cvc.intel_suggestions s
                WHERE s.id = %s AND s.status = 'pending'
            """, (suggestion_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Suggestion not found or not pending")

            d = dict(row["suggested_data"] or {})
            company_id = row["company_id"]

            if body.source_url:
                d["source_url"] = body.source_url.strip()

            if row["suggestion_type"] == "new_funding_round":
                announced_date = None
                if d.get("announced_date"):
                    try:
                        from datetime import date
                        announced_date = date.fromisoformat(str(d["announced_date"])[:10])
                    except Exception:
                        pass

                source_url = d.get("source_url")

                cur.execute("""
                    SELECT id, source, notes FROM cvc.funding_rounds
                    WHERE company_id = %s AND round_type = %s
                    LIMIT 1
                """, (company_id, d.get("round_type")))
                existing = cur.fetchone()

                if existing:
                    if source_url:
                        note = f"Source: {source_url}"
                        new_notes = (existing["notes"] + "\n" + note) if existing["notes"] else note
                        cur.execute("""
                            UPDATE cvc.funding_rounds
                            SET source = COALESCE(source, %s), notes = %s
                            WHERE id = %s
                        """, (source_url, new_notes, existing["id"]))
                else:
                    cur.execute("""
                        INSERT INTO cvc.funding_rounds
                            (company_id, round_type, amount_usd, announced_date,
                             investors, valuation_usd, approximate, source)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        company_id,
                        d.get("round_type"),
                        d.get("amount_usd"),
                        announced_date,
                        d.get("investors") or [],
                        d.get("valuation_usd"),
                        d.get("approximate", False),
                        source_url,
                    ))

            elif row["suggestion_type"] == "case_study":
                import json as _json
                cur.execute("""
                    UPDATE cvc.companies
                    SET case_studies = COALESCE(case_studies, '[]'::jsonb) || %s::jsonb
                    WHERE id = %s
                """, (_json.dumps([{
                    "title":   d.get("title", ""),
                    "url":     d.get("url", ""),
                    "snippet": d.get("snippet", ""),
                    "age":     d.get("age", ""),
                }]), company_id))

            cur.execute("""
                UPDATE cvc.intel_suggestions
                SET status = 'accepted', reviewed_at = NOW(), reviewed_by = %s
                WHERE id = %s
            """, (username, suggestion_id))
            conn.commit()

    return {"approved": True, "suggestion_id": suggestion_id}


@router.post("/suggestions/{suggestion_id}/reject")
async def reject_suggestion(suggestion_id: int, user=Depends(require_auth)):
    """Reject a suggestion — marks it dismissed."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.intel_suggestions
                SET status = 'rejected', reviewed_at = NOW()
                WHERE id = %s AND status = 'pending'
            """, (suggestion_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Suggestion not found or not pending")
            conn.commit()
    return {"rejected": True, "suggestion_id": suggestion_id}


@router.get("/enrichment-stats", response_model=EnrichmentStats)
async def get_enrichment_stats(user=Depends(require_auth)):
    """Get progress statistics on enrichment."""
    industrial_sectors = [s for s in _QA_VALID_SECTORS if s != "Other"]
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE enrichment_status = 'auto_filled') as auto_filled,
                    COUNT(*) FILTER (WHERE enrichment_status = 'manual_review') as manual_review,
                    COUNT(*) FILTER (WHERE enrichment_status = 'needs_research') as needs_research,
                    COUNT(*) FILTER (WHERE enrichment_status = 'pending' OR enrichment_status IS NULL) as pending,
                    COUNT(*) as total,
                    COUNT(*) FILTER (
                        WHERE enrichment_status = 'enriched'
                          AND (env_4d IS NULL OR func_4d IS NULL OR stack_4d IS NULL OR biz_model_4d IS NULL)
                    ) as missing_4d,
                    COUNT(*) FILTER (
                        WHERE enrichment_status = 'enriched'
                          AND env_4d IS NOT NULL AND func_4d IS NOT NULL
                          AND stack_4d IS NOT NULL AND biz_model_4d IS NOT NULL
                    ) as has_4d,
                    COUNT(*) FILTER (WHERE sector = ANY(%s)) as industrial_total,
                    COUNT(*) FILTER (
                        WHERE sector = ANY(%s)
                          AND industrial_readiness_score IS NOT NULL
                    ) as industrial_scored
                FROM cvc.companies
            """, (industrial_sectors, industrial_sectors))
            row = cur.fetchone()
            return EnrichmentStats(
                auto_filled=row["auto_filled"],
                manual_review=row["manual_review"],
                needs_research=row["needs_research"],
                pending=row["pending"],
                total=row["total"],
                missing_4d=row["missing_4d"],
                has_4d=row["has_4d"],
                industrial_total=row["industrial_total"],
                industrial_scored=row["industrial_scored"],
            )


# ── Master Activity Log ───────────────────────────────────────────────────────

@router.get("/activity-log")
def get_master_activity_log(
    person: str = Query(None, description="Filter by changed_by username"),
    source: str = Query(None, description="Filter by change_source"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user=Depends(require_auth),
):
    """
    Master activity log across all companies.
    Optional filters: person (changed_by), source (change_source).
    """
    conditions = []
    params = []

    if person and person != "all":
        conditions.append("al.changed_by = %s")
        params.append(person)
    if source and source != "all":
        conditions.append("al.change_source = %s")
        params.append(source)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT COUNT(*) AS total
                FROM cvc.company_activity_log al
                {where}
            """, params)
            total = cur.fetchone()["total"]

            cur.execute(f"""
                SELECT al.id, al.changed_by, al.changed_at, al.field_name,
                       al.old_value, al.new_value, al.change_source,
                       c.id AS company_id, c.name AS company_name, c.sector
                FROM cvc.company_activity_log al
                JOIN cvc.companies c ON c.id = al.company_id
                {where}
                ORDER BY al.changed_at DESC
                LIMIT %s OFFSET %s
            """, params + [limit, offset])
            rows = [dict(r) for r in cur.fetchall()]

    for r in rows:
        r["changed_at"] = r["changed_at"].isoformat() if r["changed_at"] else None

    return {"total": total, "offset": offset, "limit": limit, "entries": rows}


# ── Enrichment Coverage ───────────────────────────────────────────────────────

_COVERAGE_SQL = """
SELECT
    COUNT(*)                                                                AS total_companies,
    COUNT(CASE WHEN one_liner IS NOT NULL AND one_liner <> '' THEN 1 END)   AS has_one_liner,
    COUNT(CASE WHEN description IS NOT NULL AND description <> '' AND description <> '-' THEN 1 END) AS has_description,
    COUNT(CASE WHEN website IS NOT NULL AND website <> '' THEN 1 END)       AS has_website,
    COUNT(CASE WHEN founded IS NOT NULL THEN 1 END)                         AS has_founded,
    COUNT(CASE WHEN hq_city IS NOT NULL AND hq_city <> '' THEN 1 END)       AS has_hq_city,
    COUNT(CASE WHEN employee_count IS NOT NULL AND employee_count > 0 THEN 1 END) AS has_employee_count,
    COUNT(CASE WHEN total_raised_usd IS NOT NULL AND total_raised_usd > 0 THEN 1 END) AS has_total_raised,
    COUNT(CASE WHEN investors IS NOT NULL AND array_length(investors, 1) > 0 THEN 1 END) AS has_investors,
    COUNT(CASE WHEN env_4d IS NOT NULL AND env_4d <> '' THEN 1 END)         AS has_4d,
    COUNT(CASE WHEN predicted_subsector IS NOT NULL AND predicted_subsector <> '' THEN 1 END) AS has_subsector,
    COUNT(CASE WHEN score_composite IS NOT NULL THEN 1 END)                 AS has_score,
    COUNT(CASE WHEN commercial_signals IS NOT NULL THEN 1 END)              AS has_commercial_signals,
    COUNT(CASE WHEN funding_rounds IS NOT NULL AND jsonb_array_length(funding_rounds) > 0 THEN 1 END) AS has_funding_rounds,
    COUNT(CASE WHEN industrial_readiness_score IS NOT NULL THEN 1 END)      AS has_industrial_score,
    COUNT(CASE WHEN protocol_support IS NOT NULL AND jsonb_array_length(protocol_support) > 0 THEN 1 END) AS has_protocol_support,
    COUNT(CASE WHEN verified_certs IS NOT NULL AND jsonb_array_length(verified_certs) > 0 THEN 1 END) AS has_verified_certs,
    COUNT(CASE WHEN news_articles IS NOT NULL AND jsonb_array_length(news_articles) > 0 THEN 1 END) AS has_news_articles,
    COUNT(CASE WHEN case_studies IS NOT NULL AND jsonb_array_length(case_studies) > 0 THEN 1 END) AS has_case_studies,
    COUNT(CASE WHEN founders IS NOT NULL AND founders::text NOT IN ('null', '""', '[]', '{}', '') THEN 1 END) AS has_founders,
    COUNT(CASE WHEN linkedin_url IS NOT NULL AND linkedin_url <> '' THEN 1 END) AS has_linkedin
FROM cvc.companies
"""


@router.get("/admin/coverage")
def get_coverage(user=Depends(require_auth)):
    """Current field coverage counts and percentages across all companies."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(_COVERAGE_SQL)
            row = dict(cur.fetchone())

    total = row.pop("total_companies")
    fields = {}
    for key, count in row.items():
        fields[key] = {"count": count, "pct": round(count / total * 100, 1) if total else 0}

    return {"total_companies": total, "fields": fields}


@router.get("/admin/coverage/history")
def get_coverage_history(days: int = Query(90, ge=7, le=365), user=Depends(require_auth)):
    """Historical enrichment snapshots for trend charts."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM cvc.enrichment_snapshots
                WHERE snapshot_date >= CURRENT_DATE - %s::int
                ORDER BY snapshot_date ASC
            """, (days,))
            rows = cur.fetchall()

    result = []
    for r in rows:
        d = dict(r)
        d["snapshot_date"] = d["snapshot_date"].isoformat()
        d["created_at"] = d["created_at"].isoformat() if d.get("created_at") else None
        result.append(d)
    return result


# ── Enrichment Step Status ────────────────────────────────────────────────────

@router.get("/status/{company_id}")
def get_enrichment_step_status(company_id: int, user=Depends(require_auth)):
    """
    Return completion status for each of the 4 on-demand enrichment steps.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    founders,
                    env_4d,
                    founder_enriched_at,
                    fourd_enriched_at,
                    funding_enriched_at,
                    cases_enriched_at,
                    CASE
                        WHEN case_studies IS NOT NULL AND jsonb_array_length(case_studies) > 0 THEN TRUE
                        ELSE FALSE
                    END AS has_case_studies
                FROM cvc.companies WHERE id = %s
            """, (company_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")

            founder_done = bool(
                row["founders"] and
                str(row["founders"]) not in ("null", "[]", "{}", '""', "")
            )
            fourd_done = bool(row["env_4d"])
            case_studies_done = bool(row["has_case_studies"])

            founder_ran_at = row["founder_enriched_at"].isoformat() if row["founder_enriched_at"] else None
            fourd_ran_at   = row["fourd_enriched_at"].isoformat()   if row["fourd_enriched_at"]   else None
            funding_ran_at = row["funding_enriched_at"].isoformat() if row["funding_enriched_at"] else None
            cases_ran_at   = row["cases_enriched_at"].isoformat()   if row["cases_enriched_at"]   else None

            if not founder_done:
                cur.execute(
                    """SELECT 1 FROM cvc.company_intel
                       WHERE company_id = %s
                         AND uploaded_by = 'founder_research_worker'
                         AND length(coalesce(raw_text,'')) > 300
                       LIMIT 1""",
                    (company_id,)
                )
                founder_done = cur.fetchone() is not None

            cur.execute(
                "SELECT COUNT(*) AS n FROM cvc.funding_rounds WHERE company_id = %s",
                (company_id,)
            )
            fr_count = cur.fetchone()["n"]

            cur.execute("""
                SELECT COUNT(*) AS n FROM cvc.intel_suggestions
                WHERE company_id = %s AND suggestion_type = 'new_funding_round' AND status = 'pending'
            """, (company_id,))
            fs_count = cur.fetchone()["n"]
            funding_done = bool(funding_ran_at) or (fr_count + fs_count) > 0

            if not case_studies_done:
                cur.execute("""
                    SELECT COUNT(*) AS n FROM cvc.intel_suggestions
                    WHERE company_id = %s AND suggestion_type = 'case_study'
                      AND status IN ('pending', 'accepted')
                """, (company_id,))
                case_studies_done = cur.fetchone()["n"] > 0

            if not case_studies_done:
                cur.execute(
                    "SELECT revenue_arr_usd FROM cvc.companies WHERE id = %s",
                    (company_id,)
                )
                rev_row = cur.fetchone()
                case_studies_done = bool(cases_ran_at) or bool(rev_row and rev_row["revenue_arr_usd"])

    def _fmt(ts):
        if not ts:
            return None
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.strftime("%-m/%-d/%y")
        except Exception:
            return ts[:10]

    return {
        "founder": {"done": founder_done,      "last_run": _fmt(founder_ran_at)},
        "fourD":   {"done": fourd_done,        "last_run": _fmt(fourd_ran_at)},
        "funding": {"done": funding_done,      "last_run": _fmt(funding_ran_at)},
        "cases":   {"done": case_studies_done, "last_run": _fmt(cases_ran_at)},
    }
