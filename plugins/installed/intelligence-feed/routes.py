"""
Intelligence Feed plugin — routes.py
Prefix: /intel
Tag:    intelligence-feed

Endpoints:
  GET    /intel/llm-usage           — LLM cost summary (today/week/month + by activity)
  GET    /intel/sources             — list briefing sources
  POST   /intel/sources             — add briefing source
  PATCH  /intel/sources/{id}/toggle — toggle active state
  DELETE /intel/sources/{id}        — delete source
  POST   /intel/sources/detect      — auto-detect RSS feed from URL
  GET    /intel/cron                — list cron jobs
  PATCH  /intel/cron/{id}           — update cron job metadata/schedule

Dropped from staging (trend_report.* dependency, not available in platform):
  GET /intel          — sector heat scores (trend_report.raw_signals)
  GET /intel/{sector} — sector detail (trend_report.raw_signals/funding_events/patent_signals)
  GET /intel/report/{quarter} — trend report drafts (trend_report.report_drafts)
"""

import datetime
import re
from typing import Optional

import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.routes.auth import require_jwt, UserInfo
from core.db.connection import get_connection

router = APIRouter()

_ADMIN_ROLES = {"GP", "Principal", "Director"}


def _require_admin(user: UserInfo = Depends(require_jwt)) -> UserInfo:
    if user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


# ── LLM Usage ────────────────────────────────────────────────────────────────

@router.get("/llm-usage")
def get_llm_usage(user: UserInfo = Depends(_require_admin)):
    """LLM cost summary — today/week/month totals, by-activity breakdown, 20 recent calls."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    SUM(CASE WHEN called_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
                             THEN cost ELSE 0 END)  AS today_cost,
                    COUNT(CASE WHEN called_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
                               THEN 1 END)          AS today_calls,
                    SUM(CASE WHEN called_at >= date_trunc('week', now() AT TIME ZONE 'UTC')
                             THEN cost ELSE 0 END)  AS week_cost,
                    COUNT(CASE WHEN called_at >= date_trunc('week', now() AT TIME ZONE 'UTC')
                               THEN 1 END)          AS week_calls,
                    SUM(CASE WHEN called_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
                             THEN cost ELSE 0 END)  AS month_cost,
                    COUNT(CASE WHEN called_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
                               THEN 1 END)          AS month_calls
                FROM llm_usage_log
            """)
            totals = cur.fetchone()

            cur.execute("""
                SELECT
                    activity,
                    COUNT(*)       AS calls,
                    SUM(cost)      AS total_cost,
                    MAX(called_at) AS last_called
                FROM llm_usage_log
                WHERE called_at >= now() - INTERVAL '30 days'
                GROUP BY activity
                ORDER BY total_cost DESC
            """)
            by_activity = [
                {
                    "activity": r["activity"],
                    "calls": r["calls"],
                    "cost": float(r["total_cost"] or 0),
                    "last_called": r["last_called"].isoformat() if r["last_called"] else None,
                }
                for r in cur.fetchall()
            ]

            cur.execute("""
                SELECT activity, model, prompt_tokens, completion_tokens, cost, called_at
                FROM llm_usage_log
                ORDER BY called_at DESC
                LIMIT 20
            """)
            recent = [
                {
                    "activity": r["activity"],
                    "model": r["model"],
                    "prompt_tokens": r["prompt_tokens"],
                    "completion_tokens": r["completion_tokens"],
                    "cost": float(r["cost"] or 0),
                    "called_at": r["called_at"].isoformat(),
                }
                for r in cur.fetchall()
            ]

    return {
        "today":       {"calls": totals["today_calls"] or 0, "cost": float(totals["today_cost"] or 0)},
        "week":        {"calls": totals["week_calls"]  or 0, "cost": float(totals["week_cost"]  or 0)},
        "month":       {"calls": totals["month_calls"] or 0, "cost": float(totals["month_cost"] or 0)},
        "by_activity": by_activity,
        "recent":      recent,
    }


# ── Briefing Sources ──────────────────────────────────────────────────────────

class SourceIn(BaseModel):
    name: str
    url: Optional[str] = None
    source_type: str = "rss"
    category: Optional[str] = None
    notes: Optional[str] = None


@router.get("/sources")
def list_sources(user: UserInfo = Depends(_require_admin)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, url, source_type, category, active, notes, added_by, created_at
            FROM briefing_sources
            ORDER BY active DESC, source_type, name
        """)
        return [dict(r) for r in cur.fetchall()]


@router.post("/sources")
def add_source(body: SourceIn, user: UserInfo = Depends(_require_admin)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO briefing_sources (name, url, source_type, category, notes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, name, url, source_type, category, active, notes, added_by, created_at
        """, (body.name, body.url, body.source_type, body.category, body.notes))
        row = cur.fetchone()
        conn.commit()
    return dict(row)


@router.patch("/sources/{source_id}/toggle")
def toggle_source(source_id: int, user: UserInfo = Depends(_require_admin)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE briefing_sources
            SET active = NOT active, updated_at = now()
            WHERE id = %s
            RETURNING id, active
        """, (source_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")
        conn.commit()
    return dict(row)


@router.delete("/sources/{source_id}")
def delete_source(source_id: int, user: UserInfo = Depends(_require_admin)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM briefing_sources WHERE id = %s RETURNING id", (source_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")
        conn.commit()
    return {"deleted": source_id}


@router.post("/sources/detect")
def detect_source(body: dict, user: UserInfo = Depends(_require_admin)):
    """
    Given a URL, attempt to detect source_type (youtube/rss/newsletter),
    page name, and RSS feed URL.
    """
    raw_url = (body.get("url") or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="url is required")

    headers = {"User-Agent": "Mozilla/5.0 (compatible; PlatformBot/1.0)"}
    result = {"url": raw_url, "source_type": "newsletter", "name": "", "rss_url": None, "note": ""}

    # YouTube detection
    yt_match = re.search(r"youtube\.com/(@[\w-]+|channel/[\w-]+|c/[\w-]+)", raw_url)
    if yt_match:
        result["source_type"] = "youtube"
        handle = yt_match.group(1)
        try:
            r = http_requests.get(raw_url, headers=headers, timeout=10)
            title_match = re.search(r"<title>([^<]+)</title>", r.text)
            if title_match:
                result["name"] = title_match.group(1).replace(" - YouTube", "").strip()
        except Exception:
            result["name"] = handle
        result["note"] = "YouTube channel detected."
        return result

    # Fetch page and autodiscover RSS
    try:
        r = http_requests.get(raw_url, headers=headers, timeout=10)
        html = r.text

        title_match = re.search(r"<title>([^<|·–-]{3,80})", html)
        if title_match:
            result["name"] = title_match.group(1).strip()

        feed_match = re.search(
            r'<link[^>]+type=["\']application/(rss|atom)\+xml["\'][^>]+href=["\']([^"\']+)["\']',
            html, re.IGNORECASE
        ) or re.search(
            r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/(rss|atom)\+xml["\']',
            html, re.IGNORECASE
        )
        if feed_match:
            groups = feed_match.groups()
            feed_href = groups[1] if groups[0] in ("rss", "atom") else groups[0]
            if feed_href.startswith("http"):
                rss_url = feed_href
            else:
                from urllib.parse import urljoin
                rss_url = urljoin(raw_url, feed_href)
            result.update({"rss_url": rss_url, "url": rss_url, "source_type": "rss",
                           "note": "RSS feed autodiscovered from page link tags."})
            return result

        # Try common RSS paths
        from urllib.parse import urlparse
        parsed = urlparse(raw_url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        candidates = [
            raw_url.rstrip("/") + "/feed",
            raw_url.rstrip("/") + "/feed/",
            raw_url.rstrip("/") + "/rss",
            raw_url.rstrip("/") + "/rss.xml",
            base + "/feed",
            base + "/rss.xml",
            base + "/feed.xml",
        ]
        for candidate in candidates:
            try:
                probe = http_requests.get(candidate, headers=headers, timeout=6)
                ct = probe.headers.get("content-type", "")
                if probe.status_code == 200 and ("xml" in ct or "rss" in ct or probe.text.strip().startswith("<?xml")):
                    result.update({"rss_url": candidate, "url": candidate, "source_type": "rss",
                                   "note": f"RSS feed found at common path: {candidate}"})
                    return result
            except Exception:
                continue

        result["source_type"] = "newsletter"
        result["note"] = "No RSS feed detected. Will be tracked as a manual/newsletter source."

    except Exception as e:
        result["note"] = f"Could not fetch URL: {e}. Saved as manual source."

    return result


# ── Cron Jobs ─────────────────────────────────────────────────────────────────

class CronJobUpdate(BaseModel):
    name: Optional[str] = None
    schedule: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None


@router.get("/cron")
def list_cron_jobs(user: UserInfo = Depends(_require_admin)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, schedule, description, command, machine,
                   category, active, log_path, updated_at
            FROM cron_jobs
            ORDER BY machine, category, name
        """)
        return [dict(r) for r in cur.fetchall()]


@router.patch("/cron/{job_id}")
def update_cron_job(job_id: int, body: CronJobUpdate, user: UserInfo = Depends(_require_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    sets = ", ".join(f"{k} = %s" for k in updates)
    vals = list(updates.values()) + [job_id]
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE cron_jobs SET {sets}, updated_at = now() WHERE id = %s RETURNING id",
            vals,
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Job not found")
        conn.commit()
    return {"updated": job_id}
