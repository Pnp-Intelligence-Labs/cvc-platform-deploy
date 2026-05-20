from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File
from pydantic import BaseModel, Field
from typing import Optional, Literal, List
import asyncio
import csv
import io
import subprocess
import sys
import os
from datetime import datetime
from psycopg2.extras import RealDictCursor
from core.db.connection import get_connection
from api.auth import require_auth
from api.plugin_loader import get_loaded_plugins

router = APIRouter()

_ADMIN_ROLES = {"GP", "Principal", "Director"}

class BatchEnrichRequest(BaseModel):
    job: Literal["founder", "4d", "funding", "deployments", "industrial", "score_refresh"] = Field(..., description="Type of enrichment job")
    target: Literal["sector", "portfolio", "all"] = Field(..., description="Target scope")
    sector: Optional[str] = Field(None, description="Specific sector when target=sector")

class BatchJobResponse(BaseModel):
    job_id: int
    status: str
    message: str

class BatchJobStatus(BaseModel):
    id: int
    job_type: str
    target_type: str
    sector: Optional[str]
    status: str
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    results_summary: dict
    progress_current: int
    progress_total: int
    created_at: datetime

def run_batch_enrichment(job_id: int, job_type: str, target_type: str, sector: Optional[str]):
    """Background task to run batch enrichment subprocess"""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE cvc.batch_jobs SET status = 'running', started_at = NOW() WHERE id = %s",
                    (job_id,)
                )
                conn.commit()
        
        cmd = [
            sys.executable,
            "-m", 
            "workers.batch_enrichment",
            "--job-id", str(job_id),
            "--job-type", job_type,
            "--target", target_type
        ]
        if sector:
            cmd.extend(["--sector", sector])
        
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=repo_root
        )
        
        with get_connection() as conn:
            with conn.cursor() as cur:
                if result.returncode == 0:
                    cur.execute(
                        """UPDATE cvc.batch_jobs 
                           SET status = 'completed', 
                               completed_at = NOW(),
                               results_summary = %s::jsonb
                           WHERE id = %s""",
                        (result.stdout or '{}', job_id)
                    )
                else:
                    cur.execute(
                        """UPDATE cvc.batch_jobs 
                           SET status = 'failed', 
                               completed_at = NOW(),
                               error_message = %s
                           WHERE id = %s""",
                        (result.stderr or 'Unknown error', job_id)
                    )
                conn.commit()
                
    except Exception as e:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE cvc.batch_jobs 
                       SET status = 'failed', 
                           completed_at = NOW(),
                           error_message = %s
                       WHERE id = %s""",
                    (str(e), job_id)
                )
                conn.commit()

@router.post("/enrich/batch", response_model=BatchJobResponse)
async def create_batch_enrichment(
    req: BatchEnrichRequest,
    background_tasks: BackgroundTasks,
    user=Depends(require_auth)
):
    if req.target == "sector" and not req.sector:
        raise HTTPException(status_code=400, detail="Sector required when target is 'sector'")
    username = user.get("username") if isinstance(user, dict) else str(user)
    if not username:
        raise HTTPException(status_code=401, detail="Username not found in token")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO cvc.batch_jobs (job_type, target_type, sector, status, created_by)
                   VALUES (%s, %s, %s, 'pending', %s)
                   RETURNING id""",
                (req.job, req.target, req.sector, username)
            )
            row = cur.fetchone()
            job_id = row["id"]
            conn.commit()
    
    background_tasks.add_task(
        run_batch_enrichment,
        job_id,
        req.job,
        req.target,
        req.sector
    )
    
    return BatchJobResponse(
        job_id=job_id,
        status="pending",
        message=f"Batch {req.job} enrichment started for {req.target}"
    )

@router.get("/enrich/batch/latest", response_model=Optional[BatchJobStatus])
async def get_latest_batch_job(user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT id, job_type, target_type, sector, status,
                          started_at, completed_at, results_summary,
                          progress_current, progress_total, created_at
                   FROM cvc.batch_jobs
                   ORDER BY created_at DESC
                   LIMIT 1"""
            )
            row = cur.fetchone()

            if not row:
                return None

            return BatchJobStatus(
                id=row["id"],
                job_type=row["job_type"],
                target_type=row["target_type"],
                sector=row["sector"],
                status=row["status"],
                started_at=row["started_at"],
                completed_at=row["completed_at"],
                results_summary=row["results_summary"] or {},
                progress_current=row["progress_current"] or 0,
                progress_total=row["progress_total"] or 0,
                created_at=row["created_at"]
            )

@router.get("/enrich/batch/{job_id}", response_model=BatchJobStatus)
async def get_batch_job(job_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT id, job_type, target_type, sector, status,
                          started_at, completed_at, results_summary,
                          progress_current, progress_total, created_at
                   FROM cvc.batch_jobs
                   WHERE id = %s""",
                (job_id,)
            )
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Job not found")

            return BatchJobStatus(
                id=row["id"],
                job_type=row["job_type"],
                target_type=row["target_type"],
                sector=row["sector"],
                status=row["status"],
                started_at=row["started_at"],
                completed_at=row["completed_at"],
                results_summary=row["results_summary"] or {},
                progress_current=row["progress_current"] or 0,
                progress_total=row["progress_total"] or 0,
                created_at=row["created_at"]
            )


# ── Brave Search Templates ─────────────────────────────────────────────────────

class BraveTemplateUpdate(BaseModel):
    query_template: Optional[str] = None
    result_count:   Optional[int] = None
    active:         Optional[bool] = None
    notes:          Optional[str] = None


@router.get("/brave/templates")
async def list_brave_templates(user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, search_type, label, query_template, result_count, active, notes, updated_at
                FROM cvc.brave_search_templates
                ORDER BY id
            """)
            return cur.fetchall()


@router.patch("/brave/templates/{template_id}")
async def update_brave_template(
    template_id: int,
    body: BraveTemplateUpdate,
    user=Depends(require_auth)
):
    if user.get("role") not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Platform config requires GP, Principal, or Director role")
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_parts = [f"{k} = %s" for k in updates] + ["updated_at = NOW()"]
    params = list(updates.values()) + [template_id]

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"UPDATE cvc.brave_search_templates SET {', '.join(set_parts)} WHERE id = %s RETURNING *",
                params
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Template not found")
            conn.commit()
            return row


@router.get("/brave/usage")
async def brave_search_usage(user=Depends(require_auth)):
    """Period totals + per-type breakdown for the Brave search usage widget."""
    monthly_quota = int(os.environ.get("BRAVE_MONTHLY_QUOTA", 2000))

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')  AS today_searches,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS week_searches,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS month_searches,
                    COUNT(*) AS total_searches
                FROM cvc.brave_search_log
            """)
            totals = dict(cur.fetchone())

            cur.execute("""
                SELECT
                    search_type,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS month_searches,
                    ROUND(AVG(result_count) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::numeric, 1) AS avg_results,
                    ROUND(100.0 * SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END)
                          FILTER (WHERE created_at > NOW() - INTERVAL '30 days') /
                          NULLIF(COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0), 1
                    ) AS zero_pct
                FROM cvc.brave_search_log
                GROUP BY search_type
                ORDER BY month_searches DESC
            """)
            by_type = [dict(r) for r in cur.fetchall()]

    month_searches = totals.get("month_searches") or 0
    return {
        **totals,
        "monthly_quota": monthly_quota,
        "remaining": max(0, monthly_quota - month_searches),
        "pct_used": round(100 * month_searches / monthly_quota, 1) if monthly_quota else 0,
        "by_type": by_type,
    }


@router.get("/brave/stats")
async def brave_search_stats(user=Depends(require_auth)):
    """Aggregated hit rates by search_type from brave_search_log."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    search_type,
                    COUNT(*)                                              AS total_runs,
                    ROUND(AVG(result_count)::numeric, 1)                 AS avg_results,
                    ROUND(100.0 * SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1)
                                                                          AS zero_result_pct,
                    SUM(result_count)                                     AS total_results,
                    MAX(created_at)                                       AS last_run
                FROM cvc.brave_search_log
                GROUP BY search_type
                ORDER BY search_type
            """)
            return cur.fetchall()


# ── Activity Log ───────────────────────────────────────────────────────────────

@router.get("/activity")
async def get_activity(user=Depends(require_auth)):
    """Combined activity feed: batch jobs, LLM usage, company field changes."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            # All batch jobs, newest first
            cur.execute("""
                SELECT id, job_type, target_type, sector, status, created_by,
                       started_at, completed_at, progress_current, progress_total,
                       error_message, created_at
                FROM cvc.batch_jobs
                ORDER BY created_at DESC
                LIMIT 50
            """)
            batch_jobs = cur.fetchall()

            # LLM usage — last 7 days, grouped by activity + model
            cur.execute("""
                SELECT activity, model,
                       SUM(prompt_tokens)      AS prompt_tokens,
                       SUM(completion_tokens)  AS completion_tokens,
                       ROUND(SUM(cost)::numeric, 5) AS total_cost,
                       COUNT(*)                AS calls,
                       MAX(called_at)          AS last_called
                FROM cvc.llm_usage_log
                WHERE called_at > NOW() - INTERVAL '7 days'
                GROUP BY activity, model
                ORDER BY MAX(called_at) DESC
                LIMIT 100
            """)
            llm_usage = cur.fetchall()

            # Company field changes — last 100
            cur.execute("""
                SELECT cal.id, c.name AS company_name, cal.company_id,
                       cal.changed_by, cal.field_name, cal.old_value, cal.new_value,
                       cal.change_source, cal.changed_at
                FROM cvc.company_activity_log cal
                JOIN cvc.companies c ON c.id = cal.company_id
                ORDER BY cal.changed_at DESC
                LIMIT 100
            """)
            company_changes = cur.fetchall()

    return {
        "batch_jobs":      [dict(r) for r in batch_jobs],
        "llm_usage":       [dict(r) for r in llm_usage],
        "company_changes": [dict(r) for r in company_changes],
    }


@router.get("/status/{company_id}")
def get_enrichment_status(company_id: int, user=Depends(require_auth)):
    """Return last-run timestamps for each per-company enrichment step.

    Used by the CompanyProfile enrichment panel to show last run and poll
    for completion. Queries notifications inserted by refresh-enrichment.
    """
    STEP_PATTERNS = {
        "founder": "Founder Research complete",
        "fourD":   "4D Classification complete",
        "funding": "Funding Rounds enrichment complete",
        "cases":   "Case Studies & Deployments complete",
    }
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT title, MAX(created_at) AS last_run
                FROM cvc.notifications
                WHERE type = 'enrichment'
                  AND reference_id = %s
                GROUP BY title
            """, (company_id,))
            rows = cur.fetchall()

    title_to_last = {r["title"]: r["last_run"] for r in rows}
    result = {}
    for step, pattern in STEP_PATTERNS.items():
        last_run = None
        for title, ts in title_to_last.items():
            if title.startswith(pattern):
                last_run = ts.isoformat() if ts else None
                break
        result[step] = {"last_run": last_run, "done": last_run is not None}
    return result


@router.get("/kpis")
def get_admin_kpis(user=Depends(require_auth)):
    """Four-quadrant KPI snapshot for the Admin command center header."""
    with get_connection() as conn:
        with conn.cursor() as cur:

            # ── Sales ─────────────────────────────────────────────────────────
            cur.execute("""
                SELECT stage, COUNT(*) AS cnt FROM cvc.sales_targets GROUP BY stage
            """)
            sales_stages = {r["stage"]: int(r["cnt"]) for r in cur.fetchall()}
            won  = sales_stages.get("closed_won", 0)
            lost = sales_stages.get("closed_lost", 0)
            win_rate = round(won / (won + lost) * 100) if (won + lost) > 0 else None
            active_targets = sum(sales_stages.get(s, 0) for s in ("target", "nurturing", "proposal"))

            cur.execute("""
                SELECT COUNT(*) AS cnt FROM cvc.sales_targets
                WHERE stage_changed_at >= NOW() - INTERVAL '30 days'
                  AND stage NOT IN ('closed_won', 'closed_lost')
            """)
            advanced_30d = int(cur.fetchone()["cnt"])

            # ── Ventures ──────────────────────────────────────────────────────
            cur.execute("SELECT COUNT(*) AS cnt FROM cvc.companies WHERE created_at >= NOW() - INTERVAL '30 days'")
            companies_added_30d = int(cur.fetchone()["cnt"])

            cur.execute("""
                SELECT status, COUNT(*) AS cnt FROM cvc.venture_assignments GROUP BY status
            """)
            assign_by_status = {r["status"]: int(r["cnt"]) for r in cur.fetchall()}
            assignments_active    = assign_by_status.get("open", 0) + assign_by_status.get("in_progress", 0)
            assignments_done_30d  = int(assign_by_status.get("completed", 0))

            cur.execute("""
                SELECT COUNT(*) AS cnt FROM cvc.dd_evaluations
                WHERE status IN ('running', 'pending') AND updated_at >= NOW() - INTERVAL '30 days'
            """)
            dd_active = int(cur.fetchone()["cnt"])

            cur.execute("SELECT COUNT(*) AS cnt FROM cvc.companies WHERE enrichment_status IN ('pending','running')")
            enrichment_pending = int(cur.fetchone()["cnt"])

            # ── Requests ──────────────────────────────────────────────────────
            cur.execute("SELECT status, COUNT(*) AS cnt FROM cvc.requests GROUP BY status")
            req_by_status = {r["status"]: int(r["cnt"]) for r in cur.fetchall()}
            requests_open     = req_by_status.get("open", 0)
            requests_active   = req_by_status.get("active", 0)
            requests_done_30d = int(req_by_status.get("completed", 0))

            cur.execute("""
                SELECT COUNT(*) AS cnt FROM cvc.requests
                WHERE status IN ('open','active') AND updated_at < NOW() - INTERVAL '7 days'
            """)
            requests_stale = int(cur.fetchone()["cnt"])

            total_closed = requests_done_30d + req_by_status.get("cancelled", 0)
            total_opened = sum(req_by_status.values())
            completion_rate = round(requests_done_30d / total_opened * 100) if total_opened > 0 else None

            # ── Partners ──────────────────────────────────────────────────────
            cur.execute("""
                SELECT COUNT(DISTINCT partner_id) AS cnt FROM cvc.partner_intros
                WHERE created_at >= NOW() - INTERVAL '30 days'
            """)
            partners_active_30d = int(cur.fetchone()["cnt"])

            cur.execute("SELECT COUNT(*) AS cnt FROM cvc.partner_issues WHERE severity = 'high' AND resolved = false")
            high_issues = int(cur.fetchone()["cnt"])

            cur.execute("SELECT COUNT(*) AS cnt FROM cvc.partner_intros WHERE created_at >= NOW() - INTERVAL '30 days'")
            intros_30d = int(cur.fetchone()["cnt"])

            cur.execute("""
                SELECT COUNT(*) AS cnt FROM cvc.partner_dealflows WHERE status IN ('open','in_review','shortlisted','meetings')
            """)
            dealflows_active = int(cur.fetchone()["cnt"])

            cur.execute("""
                SELECT outcome, COUNT(*) AS cnt FROM cvc.partner_intros
                WHERE outcome IS NOT NULL AND outcome NOT IN ('closed','cancelled')
                GROUP BY outcome ORDER BY cnt DESC LIMIT 1
            """)
            top_row = cur.fetchone()
            top_outcome = top_row["outcome"] if top_row else None

    return {
        "sales": {
            "active_targets": active_targets,
            "stages": sales_stages,
            "win_rate": win_rate,
            "advanced_30d": advanced_30d,
            "won": won,
            "lost": lost,
        },
        "ventures": {
            "companies_added_30d": companies_added_30d,
            "assignments_active": assignments_active,
            "assignments_done_30d": assignments_done_30d,
            "dd_active": dd_active,
            "enrichment_pending": enrichment_pending,
        },
        "requests": {
            "open": requests_open,
            "active": requests_active,
            "completed_30d": requests_done_30d,
            "stale": requests_stale,
            "completion_rate": completion_rate,
        },
        "partners": {
            "active_30d": partners_active_30d,
            "high_issues": high_issues,
            "intros_30d": intros_30d,
            "dealflows_active": dealflows_active,
            "top_outcome": top_outcome,
        },
    }


# ── Plugin Health ──────────────────────────────────────────────────────────────

@router.get("/plugins/health")
def plugin_health(user=Depends(require_auth)):
    """Check health of all installed plugins.

    For each plugin, verifies its required DB tables exist.
    Returns status 'healthy' or 'degraded' per plugin.
    """
    plugins = get_loaded_plugins()
    results = []
    with get_connection() as conn:
        with conn.cursor() as cur:
            for plugin in plugins:
                tables_ok = True
                for table in plugin.get("requires_tables", []):
                    cur.execute("""
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.tables
                            WHERE table_schema = 'cvc' AND table_name = %s
                        ) AS exists
                    """, (table,))
                    if not cur.fetchone()["exists"]:
                        tables_ok = False
                        break
                results.append({
                    "slug":           plugin["slug"],
                    "name":           plugin["name"],
                    "version":        plugin["version"],
                    "status":         "healthy" if tables_ok else "degraded",
                    "tables_present": tables_ok,
                })
    return {"installed": results}


# ── Company CSV Import ────────────────────────────────────────────────────────

# Columns accepted from the CSV (subset of cvc.companies).
# All are optional except 'name'. Unknown columns are silently ignored.
_CSV_STR_COLS  = {"name", "website", "one_liner", "description", "sector",
                  "subsector", "stage", "hq_city", "hq_country", "country"}
_CSV_INT_COLS  = {"founded", "employee_count"}
_CSV_BIG_COLS  = {"total_raised_usd", "raised_total"}


def _clean_row(raw: dict) -> dict | None:
    """Normalise one CSV row into a DB-ready dict. Returns None to skip."""
    row = {k.strip().lower(): (v.strip() if isinstance(v, str) else v)
           for k, v in raw.items()}
    name = row.get("name") or row.get("company") or row.get("company_name") or ""
    name = name.strip()
    if not name:
        return None

    out: dict = {"name": name}
    for col in _CSV_STR_COLS - {"name"}:
        val = row.get(col)
        if val:
            out[col] = val
    for col in _CSV_INT_COLS:
        val = row.get(col)
        if val:
            try:
                out[col] = int(str(val).replace(",", "").split(".")[0])
            except (ValueError, TypeError):
                pass
    for col in _CSV_BIG_COLS:
        val = row.get(col)
        if val:
            try:
                out[col] = int(str(val).replace(",", "").replace("$", "").split(".")[0])
            except (ValueError, TypeError):
                pass
    return out


@router.post("/companies/import")
async def import_companies_csv(
    file: UploadFile = File(...),
    user=Depends(require_auth),
):
    """
    Bulk import companies from a CSV file.

    Required column: name (also accepts 'company' or 'company_name').
    Optional columns: website, one_liner, description, sector, subsector,
                      stage, hq_city, hq_country, country, founded,
                      employee_count, total_raised_usd.

    Deduplicates by name (case-insensitive). Existing companies are skipped.
    Returns counts: inserted, skipped (duplicate), failed (bad row).
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # strip BOM if present
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV is empty or has no data rows")

    inserted = skipped = failed = 0
    errors: list[str] = []

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Load existing names for dedup
            cur.execute("SELECT LOWER(name) FROM cvc.companies")
            existing_names = {r[0] for r in cur.fetchall()}

            for i, raw in enumerate(rows, start=2):  # row 1 = header
                cleaned = _clean_row(raw)
                if not cleaned:
                    failed += 1
                    errors.append(f"Row {i}: missing name — skipped")
                    continue

                name_lower = cleaned["name"].lower()
                if name_lower in existing_names:
                    skipped += 1
                    continue

                cols = list(cleaned.keys())
                vals = list(cleaned.values())
                placeholders = ", ".join(["%s"] * len(cols))
                col_clause = ", ".join(cols)

                try:
                    cur.execute(
                        f"INSERT INTO cvc.companies ({col_clause}, enrichment_status, enrichment_source, created_at, updated_at) "
                        f"VALUES ({placeholders}, 'pending', 'csv_import', NOW(), NOW()) "
                        f"ON CONFLICT DO NOTHING",
                        vals,
                    )
                    if cur.rowcount:
                        existing_names.add(name_lower)
                        inserted += 1
                    else:
                        skipped += 1
                except Exception as e:
                    failed += 1
                    errors.append(f"Row {i} ({cleaned.get('name', '?')}): {e}")

        conn.commit()

    return {
        "inserted": inserted,
        "skipped":  skipped,
        "failed":   failed,
        "errors":   errors[:20],  # cap error list shown
        "total_rows": len(rows),
    }
