from fastapi import APIRouter, Depends, HTTPException
from api.auth import require_auth
from core.db.connection import get_connection
import datetime

router = APIRouter(dependencies=[Depends(require_auth)])


@router.get("/llm-usage")
def get_llm_usage():
    """
    Returns OpenRouter LLM usage summary for the homepage cost widget.
    - Period totals (today, this week, this month)
    - Cost breakdown by activity (last 30 days)
    - 20 most recent calls
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            now = datetime.datetime.now(datetime.timezone.utc)

            # Period totals
            cur.execute("""
                SELECT
                    SUM(CASE WHEN called_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
                             THEN cost ELSE 0 END)                      AS today_cost,
                    COUNT(CASE WHEN called_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
                               THEN 1 END)                              AS today_calls,
                    SUM(CASE WHEN called_at >= date_trunc('week', now() AT TIME ZONE 'UTC')
                             THEN cost ELSE 0 END)                      AS week_cost,
                    COUNT(CASE WHEN called_at >= date_trunc('week', now() AT TIME ZONE 'UTC')
                               THEN 1 END)                              AS week_calls,
                    SUM(CASE WHEN called_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
                             THEN cost ELSE 0 END)                      AS month_cost,
                    COUNT(CASE WHEN called_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
                               THEN 1 END)                              AS month_calls
                FROM cvc.llm_usage_log
            """)
            totals_row = cur.fetchone()

            # By activity — last 30 days
            cur.execute("""
                SELECT
                    activity,
                    COUNT(*)                    AS calls,
                    SUM(cost)                   AS total_cost,
                    MAX(called_at)              AS last_called
                FROM cvc.llm_usage_log
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

            # 20 most recent calls
            cur.execute("""
                SELECT activity, model, prompt_tokens, completion_tokens, cost, called_at
                FROM cvc.llm_usage_log
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
        "today":    {"calls": totals_row["today_calls"] or 0,  "cost": float(totals_row["today_cost"]  or 0)},
        "week":     {"calls": totals_row["week_calls"]  or 0,  "cost": float(totals_row["week_cost"]   or 0)},
        "month":    {"calls": totals_row["month_calls"] or 0,  "cost": float(totals_row["month_cost"]  or 0)},
        "by_activity": by_activity,
        "recent":      recent,
    }


# Sector slugs match trend_report sector_tags. Display names shown in UI.
SECTORS = ["robotics", "supply_chain", "industrial_auto", "physical_ai", "manufacturing"]
SECTOR_DISPLAY_NAMES = {
    "robotics": "Robotics",
    "supply_chain": "Supply Chain",
    "industrial_auto": "Industrial Automation",
    "physical_ai": "Physical AI",
    "manufacturing": "Manufacturing",
}
# Map intelligence sector slug to cvc.companies sector value
SECTOR_TO_COMPANY_SECTOR = {
    "robotics": "robotics",
    "supply_chain": "supply_chain",
    "industrial_auto": "manufacturing",
    "physical_ai": None,
}

@router.get("")
def get_intelligence_summary():
    """
    Returns list of 4 sector cards with:
    - heat score (count of raw_signals last 30 days normalized 0-100 vs max sector)
    - top signal (latest raw_signal title)
    - funding total this quarter
    - company count
    - trend direction (this quarter vs last quarter funding)
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Get current quarter
            now = datetime.datetime.now()
            current_quarter = f"{now.year}-Q{(now.month-1)//3+1}"
            last_quarter = current_quarter
            if now.month <= 3:
                last_quarter = f"{now.year-1}-Q4"
            elif now.month <= 6:
                last_quarter = f"{now.year}-Q1"
            elif now.month <= 9:
                last_quarter = f"{now.year}-Q2"
            else:
                last_quarter = f"{now.year}-Q3"

            # Get signal counts for last 30 days for each sector
            thirty_days_ago = (now - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
            
            cur.execute("""
                SELECT 
                    sector,
                    COUNT(*) as signal_count,
                    MAX(published_at) as latest_signal_time
                FROM (
                    SELECT UNNEST(sector_tags) as sector, published_at
                    FROM trend_report.raw_signals 
                    WHERE published_at >= %s
                ) s
                WHERE sector = ANY(%s)
                GROUP BY sector
            """, (thirty_days_ago, SECTORS))
            
            signal_counts = {row["sector"]: {"count": row["signal_count"], "latest_time": row["latest_signal_time"]} for row in cur.fetchall()}
            
            max_count = max([v["count"] for v in signal_counts.values()], default=1)

            # Get top signal for each sector (latest by published_at)
            cur.execute("""
                SELECT 
                    sector,
                    title,
                    published_at
                FROM (
                    SELECT 
                        UNNEST(sector_tags) as sector,
                        title,
                        published_at,
                        ROW_NUMBER() OVER (PARTITION BY UNNEST(sector_tags) ORDER BY published_at DESC) as rn
                    FROM trend_report.raw_signals 
                    WHERE published_at >= %s
                    AND EXISTS (SELECT 1 FROM UNNEST(sector_tags) s WHERE s = ANY(%s))
                ) ranked
                WHERE rn = 1
                AND sector = ANY(%s)
            """, (thirty_days_ago, SECTORS, SECTORS))
            
            top_signals = {row["sector"]: {"title": row["title"], "published_at": row["published_at"]} for row in cur.fetchall()}

            # Get funding totals by quarter and sector
            cur.execute("""
                SELECT 
                    sector,
                    quarter,
                    SUM(amount_usd) as total_funding
                FROM (
                    SELECT 
                        UNNEST(sector_tags) as sector,
                        quarter,
                        amount_usd
                    FROM trend_report.funding_events
                    WHERE quarter IN (%s, %s)
                    AND EXISTS (SELECT 1 FROM UNNEST(sector_tags) s WHERE s = ANY(%s))
                ) f
                WHERE sector = ANY(%s)
                GROUP BY sector, quarter
            """, (current_quarter, last_quarter, SECTORS, SECTORS))
            
            funding_by_sector_quarter = {}
            for row in cur.fetchall():
                sector = row["sector"]
                quarter = row["quarter"]
                if sector not in funding_by_sector_quarter:
                    funding_by_sector_quarter[sector] = {}
                funding_by_sector_quarter[sector][quarter] = row["total_funding"]

            # Get company counts by sector using mapped company sector values
            company_sector_values = [v for v in SECTOR_TO_COMPANY_SECTOR.values() if v is not None]
            cur.execute("""
                SELECT
                    sector,
                    COUNT(*) as company_count
                FROM cvc.companies
                WHERE sector = ANY(%s)
                GROUP BY sector
            """, (company_sector_values,))
            company_counts_by_db_sector = {row["sector"]: row["company_count"] for row in cur.fetchall()}

            # Build response
            results = []
            for sector in SECTORS:
                # Heat score: 0-100 based on signal count normalized by max
                signal_count = signal_counts.get(sector, {}).get("count", 0)
                heat_score = int((signal_count / max_count) * 100) if max_count > 0 else 0

                # Top signal
                top_signal = top_signals.get(sector, {})

                # Funding total this quarter
                funding_this_q = funding_by_sector_quarter.get(sector, {}).get(current_quarter, 0)

                # Trend direction
                funding_last_q = funding_by_sector_quarter.get(sector, {}).get(last_quarter, 0)
                if funding_this_q > funding_last_q:
                    trend_direction = "up"
                elif funding_this_q < funding_last_q:
                    trend_direction = "down"
                else:
                    trend_direction = "flat"

                # Company count via mapped sector
                db_sector = SECTOR_TO_COMPANY_SECTOR.get(sector)
                company_count = company_counts_by_db_sector.get(db_sector, 0) if db_sector else 0

                results.append({
                    "sector": sector,
                    "display_name": SECTOR_DISPLAY_NAMES[sector],
                    "heat_score": heat_score,
                    "top_signal": {
                        "title": top_signal.get("title", "No recent signals"),
                        "published_at": top_signal.get("published_at")
                    } if top_signal else {"title": "No recent signals"},
                    "funding_total": int(funding_this_q),
                    "company_count": company_count,
                    "trend_direction": trend_direction
                })
            
            return {"sectors": results, "last_updated": now.isoformat()}

@router.get("/report/{quarter}")
def get_report_by_quarter(quarter: str):
    """
    Returns all report_drafts for that quarter grouped by sector
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    sector,
                    draft_text,
                    audience,
                    agent_name,
                    created_at
                FROM trend_report.report_drafts 
                WHERE quarter = %s
                ORDER BY sector, audience
            """, (quarter,))
            
            reports = {}
            for row in cur.fetchall():
                sector = row["sector"]
                if sector not in reports:
                    reports[sector] = []
                reports[sector].append({
                    "draft_text": row["draft_text"],
                    "audience": row["audience"],
                    "agent_name": row["agent_name"],
                    "created_at": row["created_at"]
                })
            
            return {
                "quarter": quarter,
                "reports": reports,
                "total_sectors": len(reports)
            }

# ── Briefing Sources ──────────────────────────────────────────────────────────

from pydantic import BaseModel
from typing import Optional
import re
import requests as http_requests

class SourceIn(BaseModel):
    name: str
    url: Optional[str] = None
    source_type: str = "rss"
    category: Optional[str] = None
    notes: Optional[str] = None

@router.get("/sources")
def list_sources():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, url, source_type, category, active, notes, added_by, created_at
            FROM cvc.briefing_sources
            ORDER BY active DESC, source_type, name
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


@router.post("/sources")
def add_source(body: SourceIn):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO cvc.briefing_sources (name, url, source_type, category, notes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, name, url, source_type, category, active, notes, added_by, created_at
        """, (body.name, body.url, body.source_type, body.category, body.notes))
        row = cur.fetchone()
        conn.commit()
    return dict(row)


@router.patch("/sources/{source_id}/toggle")
def toggle_source(source_id: int):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE cvc.briefing_sources
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
def delete_source(source_id: int):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM cvc.briefing_sources WHERE id = %s RETURNING id", (source_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")
        conn.commit()
    return {"deleted": source_id}


@router.post("/sources/detect")
def detect_source(body: dict):
    """
    Given a URL, attempt to detect:
    - source_type (youtube, rss, newsletter/manual)
    - name (from page <title> or YouTube channel name)
    - rss_url (discovered feed URL, if any)
    """
    raw_url = (body.get("url") or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="url is required")

    headers = {"User-Agent": "Mozilla/5.0 (compatible; CVCBot/1.0)"}
    result = {"url": raw_url, "source_type": "newsletter", "name": "", "rss_url": None, "note": ""}

    # ── YouTube detection ──────────────────────────────────────────────────
    yt_match = re.search(r"youtube\.com/(@[\w-]+|channel/[\w-]+|c/[\w-]+)", raw_url)
    if yt_match:
        result["source_type"] = "youtube"
        handle = yt_match.group(1)
        # Try to extract channel name from page title
        try:
            r = http_requests.get(raw_url, headers=headers, timeout=10)
            title_match = re.search(r"<title>([^<]+)</title>", r.text)
            if title_match:
                name = title_match.group(1).replace(" - YouTube", "").strip()
                result["name"] = name
        except Exception:
            result["name"] = handle
        result["note"] = "YouTube channel detected. Fetched via fetch_podcasts.py."
        return result

    # ── Try to fetch page and autodiscover RSS ─────────────────────────────
    try:
        r = http_requests.get(raw_url, headers=headers, timeout=10)
        html = r.text

        # Extract page title for name
        title_match = re.search(r"<title>([^<|·–-]{3,80})", html)
        if title_match:
            result["name"] = title_match.group(1).strip()

        # Look for RSS/Atom autodiscovery link tags
        feed_match = re.search(
            r'<link[^>]+type=["\']application/(rss|atom)\+xml["\'][^>]+href=["\']([^"\']+)["\']',
            html, re.IGNORECASE
        ) or re.search(
            r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/(rss|atom)\+xml["\']',
            html, re.IGNORECASE
        )
        if feed_match:
            groups = feed_match.groups()
            # href is in different position depending on which pattern matched
            feed_href = groups[1] if groups[0] in ("rss", "atom") else groups[0]
            # Resolve relative URLs
            if feed_href.startswith("http"):
                rss_url = feed_href
            else:
                from urllib.parse import urljoin
                rss_url = urljoin(raw_url, feed_href)
            result["rss_url"] = rss_url
            result["url"] = rss_url
            result["source_type"] = "rss"
            result["note"] = "RSS feed autodiscovered from page link tags."
            return result

        # Try common RSS URL patterns on the same domain
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
                    result["rss_url"] = candidate
                    result["url"] = candidate
                    result["source_type"] = "rss"
                    result["note"] = f"RSS feed found at common path: {candidate}"
                    return result
            except Exception:
                continue

        # No feed found — flag as manual/newsletter
        result["source_type"] = "newsletter"
        result["note"] = "No RSS feed detected. Will be tracked as a manual/newsletter source — scraped on demand, not auto-ingested."

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
def list_cron_jobs():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, schedule, description, command, machine,
                   category, active, log_path, updated_at
            FROM cvc.cron_jobs
            ORDER BY machine, category, name
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


@router.patch("/cron/{job_id}")
def update_cron_job(job_id: int, body: CronJobUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    sets = ", ".join(f"{k} = %s" for k in updates)
    vals = list(updates.values()) + [job_id]
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE cvc.cron_jobs SET {sets}, updated_at = now() WHERE id = %s RETURNING id",
            vals
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Job not found")
        conn.commit()
    return {"updated": job_id}


# ── Sector detail (catch-all — must stay LAST) ────────────────────────────────

@router.get("/{sector}")
def get_sector_detail(sector: str):
    """
    Returns sector detail:
    - narrative from trend_report.report_drafts (latest quarter, audience=partner if exists else any)
    - funding chart data (last 6 quarters from trend_report.funding_events)
    - top 10 companies by employee_count from cvc.companies
    - recent signals (last 30 days from trend_report.raw_signals)
    - patent count this quarter
    """
    if sector not in SECTORS:
        raise HTTPException(status_code=404, detail="Sector not found")

    with get_connection() as conn:
        with conn.cursor() as cur:
            now = datetime.datetime.now()
            current_quarter = f"{now.year}-Q{(now.month-1)//3+1}"

            # Get latest sector report narrative
            # section column uses 'sector_robotics' style keys; content_json has trend_narrative
            cur.execute("""
                SELECT content_json->>'trend_narrative' AS draft_text, quarter
                FROM trend_report.report_drafts
                WHERE section = CONCAT('sector_', %s)
                ORDER BY quarter DESC
                LIMIT 1
            """, (sector,))

            report_row = cur.fetchone()
            narrative = report_row["draft_text"] if report_row else None
            narrative_quarter = report_row["quarter"] if report_row else None

            # Get funding chart data - last 6 quarters for this sector
            cur.execute("""
                SELECT quarter, SUM(amount_usd) AS total_funding
                FROM trend_report.funding_events
                WHERE %s = ANY(sector_tags)
                GROUP BY quarter
                ORDER BY quarter DESC
                LIMIT 6
            """, (sector,))

            funding_data = sorted([
                {"quarter": row["quarter"], "total_funding": int(row["total_funding"])}
                for row in cur.fetchall()
            ], key=lambda x: x["quarter"])

            # Get top 10 companies — cvc.companies uses Title Case sectors
            company_sector = SECTOR_DISPLAY_NAMES.get(sector)
            cur.execute("""
                SELECT
                    id as company_id,
                    name,
                    stage,
                    employee_count,
                    hq_city,
                    country
                FROM cvc.companies
                WHERE sector = %s
                AND employee_count IS NOT NULL
                ORDER BY employee_count DESC
                LIMIT 10
            """, (company_sector,))

            companies = []
            for row in cur.fetchall():
                companies.append({
                    "company_id": row["company_id"],
                    "name": row["name"],
                    "stage": row["stage"],
                    "employee_count": row["employee_count"],
                    "hq_city": row["hq_city"],
                    "country": row["country"]
                })

            # Get recent signals - last 30 days
            thirty_days_ago = (now - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
            cur.execute("""
                SELECT
                    title,
                    source_url,
                    source_name,
                    published_at,
                    llm_summary
                FROM trend_report.raw_signals
                WHERE published_at >= %s
                AND %s = ANY(sector_tags)
                ORDER BY published_at DESC
                LIMIT 20
            """, (thirty_days_ago, sector))

            signals = []
            for row in cur.fetchall():
                signals.append({
                    "title": row["title"],
                    "url": row["source_url"],
                    "source": row["source_name"],
                    "published_at": row["published_at"],
                    "summary": row["llm_summary"]
                })

            # Get patent count this quarter
            cur.execute("""
                SELECT COUNT(*) as patent_count
                FROM trend_report.patent_signals
                WHERE quarter = %s
                AND %s = ANY(sector_tags)
            """, (current_quarter, sector))

            patent_row = cur.fetchone()
            patent_count = patent_row["patent_count"] if patent_row else 0

            # Individual funding events for drill-down
            cur.execute("""
                SELECT company_name, company_id, round_type, amount_usd,
                       investors, event_date, source_url, quarter
                FROM trend_report.funding_events
                WHERE %s = ANY(sector_tags)
                ORDER BY quarter DESC, amount_usd DESC NULLS LAST
                LIMIT 300
            """, (sector,))
            funding_events = [
                {
                    "company_name": row["company_name"],
                    "company_id":   row["company_id"],
                    "round_type":   row["round_type"] or "",
                    "amount_usd":   int(row["amount_usd"]) if row["amount_usd"] else None,
                    "investors":    row["investors"] or [],
                    "event_date":   str(row["event_date"]) if row["event_date"] else None,
                    "source_url":   row["source_url"] or "",
                    "quarter":      row["quarter"] or "",
                }
                for row in cur.fetchall()
            ]

            # Bibliography: all sources that have contributed signals for this sector
            cur.execute("""
                SELECT
                    source_name,
                    COUNT(*)                                        AS signal_count,
                    array_agg(DISTINCT signal_type)                 AS signal_types,
                    MIN(published_at)::date                         AS first_seen,
                    MAX(published_at)::date                         AS last_seen,
                    array_agg(title       ORDER BY published_at DESC) AS titles,
                    array_agg(source_url  ORDER BY published_at DESC) AS urls,
                    array_agg(quarter     ORDER BY published_at DESC) AS quarters
                FROM trend_report.raw_signals
                WHERE %s = ANY(sector_tags)
                GROUP BY source_name
                ORDER BY signal_count DESC
                LIMIT 60
            """, (sector,))
            bibliography = [
                {
                    "source_name":  row["source_name"],
                    "signal_count": row["signal_count"],
                    "signal_types": sorted(row["signal_types"] or []),
                    "first_seen":   str(row["first_seen"]) if row["first_seen"] else None,
                    "last_seen":    str(row["last_seen"])  if row["last_seen"]  else None,
                    "articles":     [
                        {"title": t, "url": u, "quarter": q}
                        for t, u, q in zip(
                            row["titles"] or [], row["urls"] or [], row["quarters"] or []
                        )
                        if t and u
                    ][:20],
                }
                for row in cur.fetchall()
            ]

            # Signal type breakdown for this sector
            cur.execute("""
                SELECT signal_type, COUNT(*) AS cnt
                FROM trend_report.raw_signals
                WHERE %s = ANY(sector_tags)
                GROUP BY signal_type
                ORDER BY cnt DESC
            """, (sector,))
            signal_breakdown = [
                {"signal_type": row["signal_type"], "count": row["cnt"]}
                for row in cur.fetchall()
            ]

            return {
                "sector": sector,
                "narrative": narrative,
                "narrative_quarter": narrative_quarter,
                "funding_data": funding_data,
                "top_companies": companies,
                "recent_signals": signals,
                "patent_count": patent_count,
                "funding_events": funding_events,
                "bibliography": bibliography,
                "signal_breakdown": signal_breakdown,
                "last_updated": now.isoformat()
            }

