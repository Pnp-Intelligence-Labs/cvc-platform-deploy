"""
GET /home/dashboard — Homepage data bundle
  - Latest weekly briefing
  - Recent activity (new companies, pipeline changes, DD evals, build tasks)
  - Notifications (items needing attention)
GET/POST/DELETE /home/messages — Home team messages (admin → team)
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from core.db.connection import get_connection
from api.auth import require_auth
from datetime import datetime, timezone, timedelta, date as date_type

router = APIRouter()


class MessageCreate(BaseModel):
    title: str
    body: str
    pinned: bool = False


@router.get("/messages")
def list_messages(user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, title, body, posted_by, pinned, created_at
                FROM cvc.home_team_messages
                ORDER BY pinned DESC, created_at DESC
            """)
            return {"messages": [dict(r) for r in cur.fetchall()]}


@router.post("/messages")
def create_message(payload: MessageCreate, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.home_team_messages (title, body, posted_by, pinned)
                VALUES (%s, %s, %s, %s)
                RETURNING id, title, body, posted_by, pinned, created_at
            """, [payload.title, payload.body, user.get("username", "admin"), payload.pinned])
            conn.commit()
            return dict(cur.fetchone())


@router.delete("/messages/{message_id}")
def delete_message(message_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.home_team_messages WHERE id = %s RETURNING id", [message_id])
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Message not found")
            conn.commit()
    return {"deleted": True}


TEAM_MEMBERS = ["nate", "jerry", "harry", "harvey", "harshal"]


@router.get("/leaderboards")
def get_leaderboards(user=Depends(require_auth)):
    """Live leaderboard stats for active team members."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Startups reviewed — distinct companies touched per user
            cur.execute("""
                SELECT changed_by, COUNT(DISTINCT company_id) AS count
                FROM cvc.company_activity_log
                WHERE changed_by = ANY(%s)
                GROUP BY changed_by
            """, (TEAM_MEMBERS,))
            reviewed = {r["changed_by"]: int(r["count"]) for r in cur.fetchall()}

            # Introductions — companies where intro fields were updated by each user
            cur.execute("""
                SELECT changed_by, COUNT(DISTINCT company_id) AS count
                FROM cvc.company_activity_log
                WHERE changed_by = ANY(%s)
                  AND field_name IN ('intro_partners', 'intro_count', 'last_intro_date')
                GROUP BY changed_by
            """, (TEAM_MEMBERS,))
            intros = {r["changed_by"]: int(r["count"]) for r in cur.fetchall()}

            # Partner data — companies with partner-related field updates
            cur.execute("""
                SELECT changed_by, COUNT(DISTINCT company_id) AS count
                FROM cvc.company_activity_log
                WHERE changed_by = ANY(%s)
                  AND (field_name ILIKE '%%partner%%' OR change_source IN ('funding_round', 'commercial_deployment'))
                GROUP BY changed_by
            """, (TEAM_MEMBERS,))
            partner_data = {r["changed_by"]: int(r["count"]) for r in cur.fetchall()}

    def board(counts: dict) -> list:
        return sorted(
            [{"name": m.capitalize(), "count": counts.get(m, 0)} for m in TEAM_MEMBERS],
            key=lambda x: x["count"], reverse=True
        )

    return {
        "startups_reviewed": board(reviewed),
        "introductions":     board(intros),
        "partner_data":      board(partner_data),
    }


@router.get("/dashboard")
def get_dashboard():
    with get_connection() as conn, conn.cursor() as cur:

        # ── Weekly briefings (last 6) ────────────────────────────────────────
        cur.execute("""
            SELECT week_start, week_end, total_items, podcast_count, news_count,
                   article_count, sentiment_positive, sentiment_neutral, sentiment_negative,
                   top_tags, top_companies, top_technologies, briefing_text, created_at
            FROM cvc.weekly_signals
            ORDER BY week_start DESC
            LIMIT 6
        """)
        briefing_rows = cur.fetchall()

        # Fetch insights from briefing_insights table, grouped by week + sector
        insights_by_week: dict = {}
        sectors_by_week: dict = {}
        if briefing_rows:
            week_starts = [r["week_start"] for r in briefing_rows]
            cur.execute("""
                SELECT id, week_start, source_type, source_title, source_url,
                       show_name, insight, expert, confidence, sector, created_at
                FROM cvc.briefing_insights
                WHERE week_start = ANY(%s)
                ORDER BY week_start DESC, sector, source_type, source_title
            """, (week_starts,))
            for ins in cur.fetchall():
                key = str(ins["week_start"])
                sector = ins["sector"] or "General"
                entry = {
                    "id":           ins["id"],
                    "source_type":  ins["source_type"],
                    "source_title": ins["source_title"] or "",
                    "source_url":   ins["source_url"] or "",
                    "show_name":    ins["show_name"] or "",
                    "insight":      ins["insight"],
                    "expert":       ins["expert"] or "",
                    "confidence":   ins["confidence"] or "",
                    "sector":       sector,
                    "created_at":   str(ins["created_at"]),
                }
                insights_by_week.setdefault(key, []).append(entry)
                sectors_by_week.setdefault(key, {}).setdefault(sector, []).append(entry)

        # Fallback: for weeks that predate briefing_insights, pull podcast sources
        # from content_items so old briefings still show something
        legacy_sources_by_week: dict = {}
        if briefing_rows:
            weeks_needing_legacy = [
                r for r in briefing_rows
                if not insights_by_week.get(str(r["week_start"]))
            ]
            if weeks_needing_legacy:
                min_start = min(r["week_start"] for r in weeks_needing_legacy)
                max_end   = max(r["week_end"]   for r in weeks_needing_legacy)
                cur.execute("""
                    SELECT
                        created_at::date                                   AS day,
                        title,
                        podcast_synthesis->>'source'                       AS show_name,
                        jsonb_array_length(podcast_synthesis->'insights')  AS insight_count
                    FROM cvc.content_items
                    WHERE content_type = 'podcast_episode'
                      AND enrichment_status = 'fully_enriched'
                      AND podcast_synthesis IS NOT NULL
                      AND created_at >= %s AND created_at < %s
                    ORDER BY insight_count DESC
                """, (min_start, max_end + timedelta(days=1)))
                for s in cur.fetchall():
                    day = s["day"]
                    for r in weeks_needing_legacy:
                        if r["week_start"] <= day <= r["week_end"]:
                            key = str(r["week_start"])
                            legacy_sources_by_week.setdefault(key, []).append({
                                "source_type":  "podcast",
                                "source_title": s["title"],
                                "source_url":   "",
                                "show_name":    s["show_name"] or "",
                                "insight":      "",
                                "expert":       "",
                                "confidence":   "",
                                "created_at":   "",
                            })
                            break

        briefings = []
        for row in briefing_rows:
            week_start = row["week_start"]
            week_key   = str(week_start)
            insights   = insights_by_week.get(week_key) or legacy_sources_by_week.get(week_key, [])
            # Sector order: CVC priority sectors first, then General
            SECTOR_ORDER = ["Supply Chain", "Robotics", "Physical AI", "Industrial Automation", "Manufacturing", "General"]
            raw_sectors = sectors_by_week.get(week_key, {})
            signals_by_sector = {
                s: raw_sectors[s]
                for s in SECTOR_ORDER if s in raw_sectors
            }
            # Any unexpected sectors appended after
            for s in raw_sectors:
                if s not in signals_by_sector:
                    signals_by_sector[s] = raw_sectors[s]

            briefings.append({
                "week_start":         week_key,
                "week_end":           str(row["week_end"]),
                "total_items":        row["total_items"],
                "podcast_count":      row["podcast_count"],
                "news_count":         row["news_count"],
                "article_count":      row["article_count"],
                "top_tags":           row["top_tags"] or [],
                "top_companies":      row["top_companies"] or [],
                "top_technologies":   row["top_technologies"] or [],
                "briefing_text":      row["briefing_text"],
                "created_at":         str(row["created_at"]) if row["created_at"] else None,
                "insights":           insights,
                "total_insights":     len(insights),
                "signals_by_sector":  signals_by_sector,
            })

        # ── Recent activity (last 14 days) ───────────────────────────────────
        cutoff = datetime.now(timezone.utc) - timedelta(days=14)
        activity = []

        # New companies added
        cur.execute("""
            SELECT id, name, sector, created_at
            FROM cvc.companies
            WHERE created_at >= %s
            ORDER BY created_at DESC
            LIMIT 15
        """, (cutoff,))
        for row in cur.fetchall():
            activity.append({
                "type":       "new_company",
                "label":      f"{row['name']} added",
                "sub":        row["sector"] or "Unclassified",
                "company_id": row["id"],
                "ts":         row["created_at"].isoformat(),
            })

        # Pipeline status changes
        cur.execute("""
            SELECT cl.status, cl.status_changed_at, cl.changed_by,
                   c.id AS company_id, c.name AS company_name
            FROM cvc.company_lifecycle cl
            JOIN cvc.companies c ON c.id = cl.company_id
            WHERE cl.status_changed_at >= %s
            ORDER BY cl.status_changed_at DESC
            LIMIT 15
        """, (cutoff,))
        STATUS_LABEL = {
            "discovered":    "Discovered",
            "due_diligence": "Due Diligence",
            "invested":      "Invested",
            "passed":        "Passed",
            "passed":       "Passed",
            "invested":     "Invested",
            "portfolio":    "Portfolio",
        }
        for row in cur.fetchall():
            activity.append({
                "type":       "pipeline_change",
                "label":      f"{row['company_name']} \u2192 {STATUS_LABEL.get(row['status'], row['status'])}",
                "sub":        f"by {row['changed_by']}" if row["changed_by"] else "",
                "company_id": row["company_id"],
                "ts":         row["status_changed_at"].isoformat(),
                "user":       row["changed_by"] or None,
            })

        # Completed DD evaluations
        cur.execute("""
            SELECT dd.id AS dd_id, dd.score_overall, dd.updated_at,
                   c.id AS company_id, c.name AS company_name
            FROM cvc.dd_evaluations dd
            JOIN cvc.companies c ON c.id = dd.company_id
            WHERE dd.status = 'completed' AND dd.updated_at >= %s
            ORDER BY dd.updated_at DESC
            LIMIT 10
        """, (cutoff,))
        for row in cur.fetchall():
            score = f"{float(row['score_overall']):.0f}/100" if row["score_overall"] else "\u2014"
            activity.append({
                "type":       "dd_completed",
                "label":      f"DD complete \u2014 {row['company_name']}",
                "sub":        f"Score: {score}",
                "company_id": row["company_id"],
                "ts":         row["updated_at"].isoformat(),
            })

        # Deployed build tasks
        cur.execute("""
            SELECT task_id, spec, deployed_at
            FROM cvc.build_tasks
            WHERE status = 'deployed' AND deployed_at >= %s
            ORDER BY deployed_at DESC
            LIMIT 8
        """, (cutoff,))
        for row in cur.fetchall():
            spec_short = (row["spec"] or "")[:80].rstrip()
            activity.append({
                "type":  "build_deployed",
                "label": f"Deployed: {spec_short}",
                "sub":   f"Task #{row['task_id']}",
                "ts":    row["deployed_at"].isoformat(),
            })

        # Profile edits from company_activity_log (analyst-attributed field changes)
        cur.execute("""
            SELECT al.changed_by, al.changed_at, al.field_name, al.new_value,
                   al.change_source, c.id AS company_id, c.name AS company_name
            FROM cvc.company_activity_log al
            JOIN cvc.companies c ON c.id = al.company_id
            WHERE al.changed_at >= %s
              AND al.change_source IN ('manual', 'funding_round', 'commercial_deployment', 'intel_upload', 'eintel')
            ORDER BY al.changed_at DESC
            LIMIT 20
        """, (cutoff,))
        FIELD_LABELS = {
            "funding_round_added":              "added a funding round",
            "funding_round_updated":            "updated a funding round",
            "funding_round_deleted":            "deleted a funding round",
            "commercial_deployment_added":      "added a commercial deployment",
            "commercial_deployment_updated":    "updated a commercial deployment",
            "commercial_deployment_deleted":    "deleted a commercial deployment",
            "commercial_signals":               "updated commercial signals",
            "intel_uploaded":                   "uploaded intel",
            "funding_round":                    "approved a funding round",
            "case_studies":                     "approved a case study",
            "intel_suggestion_new_funding_round": "rejected a funding round suggestion",
            "intel_suggestion_case_study":      "rejected a case study",
        }
        for row in cur.fetchall():
            field = row["field_name"]
            action = FIELD_LABELS.get(field, f"updated {field.replace('_', ' ')}")
            new_val = (row["new_value"] or "")[:60]
            evt_type = "intel_approved" if row["change_source"] == "eintel" else "profile_edit"
            activity.append({
                "type":       evt_type,
                "label":      f"{row['company_name']} — {action}",
                "sub":        new_val or "",
                "company_id": row["company_id"],
                "ts":         row["changed_at"].isoformat(),
                "user":       row["changed_by"] or None,
            })

        # Partner intros
        cur.execute("""
            SELECT pi.startup_name, pi.partner_name, pi.intro_date, pi.created_at,
                   c.id AS company_id
            FROM cvc.partner_intros pi
            LEFT JOIN cvc.companies c ON c.id = pi.company_id
            WHERE pi.created_at >= %s
            ORDER BY pi.created_at DESC
            LIMIT 15
        """, (cutoff,))
        for row in cur.fetchall():
            activity.append({
                "type":       "partner_intro",
                "label":      f"{row['partner_name']} → {row['startup_name']}",
                "sub":        f"intro {row['intro_date'].strftime('%b %-d') if row['intro_date'] else ''}".strip(),
                "company_id": row["company_id"],
                "ts":         row["created_at"].isoformat(),
            })

        # New investments (term sheets)
        cur.execute("""
            SELECT ts.created_at, ts.fund, ts.round_type, ts.check_size_usd,
                   c.id AS company_id, c.name AS company_name
            FROM cvc.term_sheets ts
            JOIN cvc.companies c ON c.id = ts.company_id
            WHERE ts.created_at >= %s
            ORDER BY ts.created_at DESC
            LIMIT 10
        """, (cutoff,))
        for row in cur.fetchall():
            check = f"${row['check_size_usd']:,.0f}" if row["check_size_usd"] else ""
            fund = row["fund"] or ""
            sub_parts = [p for p in [fund, row["round_type"], check] if p]
            activity.append({
                "type":       "new_investment",
                "label":      f"Invested — {row['company_name']}",
                "sub":        "  ·  ".join(sub_parts),
                "company_id": row["company_id"],
                "ts":         row["created_at"].isoformat(),
            })

        # Briefing upvotes — team engagement signal
        cur.execute("""
            SELECT bu.insight_text, bu.section, bu.upvoted_by, bu.created_at
            FROM cvc.briefing_upvotes bu
            WHERE bu.created_at >= %s
            ORDER BY bu.created_at DESC
            LIMIT 20
        """, (cutoff,))
        for row in cur.fetchall():
            short = (row["insight_text"] or "")[:70]
            activity.append({
                "type":  "briefing_upvote",
                "label": f"Upvoted in briefing — {row['section']}",
                "sub":   short,
                "ts":    row["created_at"].isoformat(),
                "user":  row["upvoted_by"],
            })

        activity.sort(key=lambda x: x["ts"], reverse=True)
        activity = activity[:30]

        # ── Notifications ────────────────────────────────────────────────────
        notifications = []

        # Build tasks awaiting Nate's approval
        cur.execute("""
            SELECT task_id, spec, created_at, priority
            FROM cvc.build_tasks
            WHERE requires_approval = true AND status = 'pending' AND nate_approved_at IS NULL
            ORDER BY created_at DESC
        """)
        for row in cur.fetchall():
            spec_short = (row["spec"] or "")[:100].rstrip()
            notifications.append({
                "type":     "approval_needed",
                "label":    f"Approval needed: {spec_short}",
                "priority": row["priority"],
                "task_id":  row["task_id"],
                "ts":       row["created_at"].isoformat(),
            })

        # Completed DD evals not yet reviewed
        cur.execute("""
            SELECT dd.id AS dd_id, c.name AS company_name,
                   dd.score_overall, dd.updated_at
            FROM cvc.dd_evaluations dd
            JOIN cvc.companies c ON c.id = dd.company_id
            WHERE dd.status = 'completed'
              AND (dd.evaluator_notes IS NULL OR dd.evaluator_notes = '')
            ORDER BY dd.updated_at DESC
            LIMIT 10
        """)
        for row in cur.fetchall():
            score = f"{float(row['score_overall']):.0f}/100" if row["score_overall"] else "\u2014"
            notifications.append({
                "type":       "dd_review",
                "label":      f"DD ready for review \u2014 {row['company_name']}",
                "sub":        f"Score: {score}",
                "company_id": row["dd_id"],
                "ts":         row["updated_at"].isoformat(),
            })

    return {
        "briefings":     briefings,
        "activity":      activity,
        "notifications": notifications,
    }


@router.get("/deliverables")
def get_deliverables(user=Depends(require_auth)):
    """Return open + active requests for the homepage deliverables table."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    r.id, r.title, r.service_type, r.status, r.priority, r.updated_at,
                    COALESCE(r.partner_name, p.name) AS partner_name,
                    COALESCE(
                        array_agg(ra.username ORDER BY ra.assigned_at) FILTER (WHERE ra.username IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS assignees
                FROM cvc.requests r
                LEFT JOIN cvc.partners p ON p.id = r.partner_id
                LEFT JOIN cvc.request_assignees ra ON ra.request_id = r.id
                WHERE r.status IN ('open', 'active')
                GROUP BY r.id, p.name
                ORDER BY
                    CASE r.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                    r.updated_at DESC
                LIMIT 12
            """)
            rows = cur.fetchall()
    return {"deliverables": [
        {
            "id":           r["id"],
            "title":        r["title"],
            "service_type": r["service_type"],
            "status":       r["status"],
            "priority":     r["priority"],
            "partner_name": r["partner_name"],
            "assignees":    list(r["assignees"]) if r["assignees"] else [],
            "updated_at":   r["updated_at"].isoformat() if r["updated_at"] else None,
        }
        for r in rows
    ]}


@router.get("/team-activity")
def get_team_activity(user=Depends(require_auth)):
    """All user-attributed activity for the last 14 days — used by Admin team cards.
    No global cap so every team member's actions show up regardless of total volume."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    activity = []
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Pipeline status changes
            cur.execute("""
                SELECT cl.status, cl.status_changed_at, cl.changed_by,
                       c.id AS company_id, c.name AS company_name
                FROM cvc.company_lifecycle cl
                JOIN cvc.companies c ON c.id = cl.company_id
                WHERE cl.status_changed_at >= %s AND cl.changed_by IS NOT NULL
                ORDER BY cl.status_changed_at DESC
            """, (cutoff,))
            STATUS_LABEL = {
                "discovered": "Discovered", "due_diligence": "Due Diligence",
                "invested": "Invested", "passed": "Passed", "portfolio": "Portfolio",
            }
            for row in cur.fetchall():
                activity.append({
                    "type":       "pipeline_change",
                    "label":      f"{row['company_name']} \u2192 {STATUS_LABEL.get(row['status'], row['status'])}",
                    "sub":        "",
                    "company_id": row["company_id"],
                    "ts":         row["status_changed_at"].isoformat(),
                    "user":       row["changed_by"],
                })

            # Company field edits
            cur.execute("""
                SELECT al.changed_by, al.changed_at, al.field_name,
                       al.change_source, c.id AS company_id, c.name AS company_name
                FROM cvc.company_activity_log al
                JOIN cvc.companies c ON c.id = al.company_id
                WHERE al.changed_at >= %s AND al.changed_by IS NOT NULL
                  AND al.change_source IN ('manual', 'funding_round', 'commercial_deployment', 'intel_upload', 'eintel')
                ORDER BY al.changed_at DESC
            """, (cutoff,))
            FIELD_LABELS = {
                "funding_round_added": "added a funding round",
                "funding_round_updated": "updated a funding round",
                "funding_round_deleted": "deleted a funding round",
                "commercial_deployment_added": "added a commercial deployment",
                "commercial_deployment_deleted": "deleted a commercial deployment",
                "intel_uploaded": "uploaded intel",
                "funding_round": "approved a funding round",
                "case_studies": "added case studies",
            }
            for row in cur.fetchall():
                field = row["field_name"]
                action = FIELD_LABELS.get(field, f"updated {field.replace('_', ' ')}")
                evt_type = "intel_approved" if row["change_source"] == "eintel" else "profile_edit"
                activity.append({
                    "type":       evt_type,
                    "label":      f"{row['company_name']} — {action}",
                    "sub":        "",
                    "company_id": row["company_id"],
                    "ts":         row["changed_at"].isoformat(),
                    "user":       row["changed_by"],
                })

            # Briefing upvotes
            cur.execute("""
                SELECT bu.insight_text, bu.section, bu.upvoted_by, bu.created_at
                FROM cvc.briefing_upvotes bu
                WHERE bu.created_at >= %s
                ORDER BY bu.created_at DESC
            """, (cutoff,))
            for row in cur.fetchall():
                activity.append({
                    "type":  "briefing_upvote",
                    "label": f"Upvoted in briefing — {row['section']}",
                    "sub":   (row["insight_text"] or "")[:70],
                    "ts":    row["created_at"].isoformat(),
                    "user":  row["upvoted_by"],
                })

    activity.sort(key=lambda x: x["ts"], reverse=True)
    return {"activity": activity}


@router.get("/my-activity")
def get_my_activity(user=Depends(require_auth)):
    """Return the logged-in user's recent edits from company_activity_log."""
    username = user.get("username")
    if not username:
        return {"edits": []}
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT al.changed_at, al.field_name, al.new_value, al.change_source,
                       c.id AS company_id, c.name AS company_name
                FROM cvc.company_activity_log al
                JOIN cvc.companies c ON c.id = al.company_id
                WHERE al.changed_by = %s
                  AND al.change_source IN ('manual', 'funding_round', 'commercial_deployment', 'intel_upload', 'eintel')
                ORDER BY al.changed_at DESC
                LIMIT 10
            """, (username,))
            rows = cur.fetchall()
    FIELD_LABELS = {
        "funding_round_added":           "added a funding round",
        "funding_round_updated":         "updated a funding round",
        "funding_round_deleted":         "deleted a funding round",
        "commercial_deployment_added":   "added a commercial deployment",
        "commercial_deployment_deleted": "deleted a commercial deployment",
        "intel_uploaded":                "uploaded intel",
        "case_studies":                  "added case studies",
    }
    edits = []
    for row in rows:
        field = row["field_name"]
        action = FIELD_LABELS.get(field, f"updated {field}")
        edits.append({
            "company_id":   row["company_id"],
            "company_name": row["company_name"],
            "action":       action,
            "ts":           row["changed_at"].isoformat(),
        })
    return {"edits": edits}


import math as _math

# ── Traction scoring constants ─────────────────────────────────────────────────
_MILESTONE_PTS: dict[str, float] = {
    'nda':                  10.0,
    'poc':                  25.0,
    'pilot':                50.0,
    'commercial agreement': 150.0,
    'commercial':           150.0,
}
_SLOW_STAGES = {'poc', 'pilot', 'commercial agreement', 'commercial'}
_FAST_LAMBDA = _math.log(2) / 21    # intro / NDA half-life = 21 days
_SLOW_LAMBDA = _math.log(2) / 90    # PoC / Pilot / Commercial half-life = 90 days
_WINDOW_MAP = {
    '14d':  (14,  28),
    '2mo':  (60,  120),
    '6mo':  (180, 360),
}


def _parse_ts(ts_str: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    except Exception:
        return None


def _score_intros(intros: list, win_start: datetime, win_end: datetime) -> float:
    """Return decay-adjusted traction score for a list of intro rows within the window."""
    score = 0.0
    momentum_end = None  # if a PSM updated within last 7 days relative to win_end

    for intro in intros:
        intro_date = intro['intro_date']
        if intro_date is None:
            continue
        # psycopg2 returns date objects — convert to datetime
        if not isinstance(intro_date, datetime):
            intro_date = datetime(intro_date.year, intro_date.month, intro_date.day, tzinfo=timezone.utc)
        else:
            if intro_date.tzinfo is None:
                intro_date = intro_date.replace(tzinfo=timezone.utc)

        # Intro milestone
        if win_start <= intro_date <= win_end:
            days_ago = (win_end - intro_date).total_seconds() / 86400
            score += 1.0 * _math.exp(-_FAST_LAMBDA * days_ago)

        # Status log milestones — log is stored newest-first, process chronologically
        log = intro.get('status_log') or []
        prev_ts = intro_date

        for entry in reversed(log):
            stage_key = (entry.get('outcome') or '').lower().strip()
            ts = _parse_ts(entry.get('ts', ''))
            if ts is None:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            if win_start <= ts <= win_end:
                base = _MILESTONE_PTS.get(stage_key, 0.0)
                if base:
                    # Velocity bonus: stage change in <30 days
                    days_since_prev = (ts - prev_ts).total_seconds() / 86400
                    if 0 < days_since_prev < 30:
                        base *= 1.5
                    lam = _SLOW_LAMBDA if stage_key in _SLOW_STAGES else _FAST_LAMBDA
                    days_ago = (win_end - ts).total_seconds() / 86400
                    score += base * _math.exp(-lam * days_ago)

                # Track most recent log ts for momentum check
                if momentum_end is None or ts > momentum_end:
                    momentum_end = ts

            prev_ts = ts

    # Momentum boost: +20% if any log entry in the 7 days before win_end
    if momentum_end and (win_end - momentum_end).total_seconds() / 86400 <= 7:
        score *= 1.2

    return score


def _has_velocity(intros: list, win_start: datetime, win_end: datetime) -> bool:
    """True if any intro had a stage transition in <30 days within the window."""
    for intro in intros:
        intro_date = intro['intro_date']
        if intro_date is None:
            continue
        if not isinstance(intro_date, datetime):
            intro_date = datetime(intro_date.year, intro_date.month, intro_date.day, tzinfo=timezone.utc)
        log = intro.get('status_log') or []
        prev = intro_date
        for entry in reversed(log):
            stage_key = (entry.get('outcome') or '').lower().strip()
            ts = _parse_ts(entry.get('ts', ''))
            if ts is None:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if stage_key in _MILESTONE_PTS and win_start <= ts <= win_end:
                days_since = (ts - prev).total_seconds() / 86400
                if 0 < days_since < 30:
                    return True
            prev = ts
    return False


def _last_updated(intros: list) -> datetime | None:
    latest = None
    for intro in intros:
        log = intro.get('status_log') or []
        if log:
            ts = _parse_ts(log[0].get('ts', ''))  # log is newest-first
            if ts and (latest is None or ts > latest):
                latest = ts
    return latest


def _current_stage(intros: list) -> str | None:
    """Return the highest milestone stage across all intros."""
    stage_rank = {'commercial agreement': 5, 'commercial': 5, 'pilot': 4, 'poc': 3, 'nda': 2, 'hold': 1, 'close': 0}
    best_key = None
    best_rank = -1
    best_label = None
    for intro in intros:
        outcome = (intro.get('outcome') or '').strip()
        key = outcome.lower()
        rank = stage_rank.get(key, -1)
        if rank > best_rank:
            best_rank = rank
            best_key = key
            best_label = outcome
    return best_label


def _is_stagnating(intros: list, now: datetime) -> bool:
    """True if last status_log update is >45 days ago across all intros."""
    lu = _last_updated(intros)
    if lu is None:
        return False
    if lu.tzinfo is None:
        lu = lu.replace(tzinfo=timezone.utc)
    return (now - lu).total_seconds() / 86400 > 45


@router.get("/traction")
def get_traction(window: str = "2mo", user=Depends(require_auth)):
    """Return decay-scored traction leaderboard for all companies with partner intros."""
    if window not in _WINDOW_MAP:
        window = "2mo"
    cur_days, prior_days = _WINDOW_MAP[window]
    now = datetime.now(timezone.utc)
    win_start  = now - timedelta(days=cur_days)
    prior_start = now - timedelta(days=prior_days)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT pi.id, pi.company_id, c.name AS company_name,
                       pi.intro_date, pi.outcome, pi.status_log
                FROM cvc.partner_intros pi
                LEFT JOIN cvc.companies c ON c.id = pi.company_id
                WHERE pi.intro_date >= %s
                ORDER BY pi.company_id, pi.intro_date
            """, (prior_start.date(),))
            rows = cur.fetchall()

    from collections import defaultdict
    by_company: dict[int, list] = defaultdict(list)
    for r in rows:
        by_company[r['company_id']].append(r)

    results = []
    for company_id, intros in by_company.items():
        if company_id is None:
            continue
        name = intros[0]['company_name'] or f"Company {company_id}"
        cur_score  = _score_intros(intros, win_start, now)
        prev_score = _score_intros(intros, prior_start, win_start)
        delta = cur_score - prev_score
        lu = _last_updated(intros)
        results.append({
            'company_id':       company_id,
            'company_name':     name,
            'score':            round(cur_score, 1),
            'stage':            _current_stage(intros),
            'intro_count':      len(intros),
            'velocity_active':  _has_velocity(intros, win_start, now),
            'stagnating':       _is_stagnating(intros, now),
            'delta_score':      round(delta, 1),
            'delta_direction':  'up' if delta > 0.5 else ('down' if delta < -0.5 else 'flat'),
            'last_updated':     lu.isoformat() if lu else None,
        })

    results.sort(key=lambda x: x['score'], reverse=True)
    return {'window': window, 'companies': results[:50], 'generated_at': now.isoformat()}


@router.get("/traction/psm-leaderboard")
def get_traction_psm_leaderboard(user=Depends(require_auth)):
    """Return per-PSM points generated this month + data freshness score."""
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    two_weeks_ago = now - timedelta(days=14)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, status_log FROM cvc.partner_intros
                WHERE status_log IS NOT NULL AND jsonb_array_length(status_log) > 0
            """)
            rows = cur.fetchall()

    from collections import defaultdict
    psm_points:      dict[str, float]      = defaultdict(float)
    psm_all_intros:  dict[str, set]        = defaultdict(set)
    psm_fresh_intros: dict[str, set]       = defaultdict(set)

    for row in rows:
        intro_id = row['id']
        log = row['status_log'] or []
        for entry in log:
            logged_by = (entry.get('logged_by') or '').strip()
            if not logged_by:
                continue
            ts = _parse_ts(entry.get('ts', ''))
            if ts is None:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            stage_key = (entry.get('outcome') or '').lower().strip()
            psm_all_intros[logged_by].add(intro_id)
            if ts >= month_start:
                base = _MILESTONE_PTS.get(stage_key, 0.0)
                if base:
                    psm_points[logged_by] += base
            if ts >= two_weeks_ago:
                psm_fresh_intros[logged_by].add(intro_id)

    psms = []
    for psm_name in set(list(psm_points.keys()) + list(psm_all_intros.keys())):
        total = len(psm_all_intros[psm_name])
        fresh = len(psm_fresh_intros[psm_name])
        psms.append({
            'psm_name':         psm_name,
            'points_this_month': round(psm_points[psm_name], 1),
            'freshness_score':  round(fresh / total, 2) if total > 0 else 0.0,
            'intro_count':      total,
        })
    psms.sort(key=lambda x: x['points_this_month'], reverse=True)
    return {'psms': psms, 'month': month_start.strftime('%B %Y')}


class UpvoteBody(BaseModel):
    week_start: str           # YYYY-MM-DD
    insight_id: Optional[int] = None
    insight_text: str
    section: str = "Podcasts"
    source_title: Optional[str] = None
    source_url: Optional[str] = None


@router.post("/briefings/upvote")
def toggle_upvote(body: UpvoteBody, user=Depends(require_auth)):
    """Toggle upvote on a briefing insight. Returns {upvoted, total, voters}."""
    username = user.get("username", "analyst") if isinstance(user, dict) else str(user)
    week_start = date_type.fromisoformat(body.week_start[:10])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id FROM cvc.briefing_upvotes
                WHERE week_start = %s AND insight_text = %s AND upvoted_by = %s
            """, (week_start, body.insight_text, username))
            existing = cur.fetchone()
            if existing:
                cur.execute("DELETE FROM cvc.briefing_upvotes WHERE id = %s", (existing["id"],))
                upvoted = False
            else:
                cur.execute("""
                    INSERT INTO cvc.briefing_upvotes
                        (week_start, insight_id, insight_text, section, source_title, source_url, upvoted_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (week_start, body.insight_id, body.insight_text, body.section,
                      body.source_title, body.source_url, username))
                upvoted = True
            cur.execute("""
                SELECT COUNT(*) AS cnt,
                       ARRAY_AGG(upvoted_by ORDER BY created_at) AS voters
                FROM cvc.briefing_upvotes
                WHERE week_start = %s AND insight_text = %s
            """, (week_start, body.insight_text))
            agg = cur.fetchone()
            conn.commit()
    return {"upvoted": upvoted, "total": int(agg["cnt"]), "voters": list(agg["voters"] or [])}


@router.get("/briefings/upvotes/{week_start}")
def get_briefing_upvotes(week_start: str):
    """All upvoted insights for a briefing week, sorted by vote count. No auth required (read-only)."""
    ws = date_type.fromisoformat(week_start[:10])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT insight_text, section, source_title, source_url,
                       COUNT(*) AS count,
                       ARRAY_AGG(upvoted_by ORDER BY created_at) AS voters
                FROM cvc.briefing_upvotes
                WHERE week_start = %s
                GROUP BY insight_text, section, source_title, source_url
                ORDER BY count DESC, MAX(created_at) DESC
            """, (ws,))
            return [
                {
                    "insight_text": r["insight_text"],
                    "section":      r["section"],
                    "source_title": r["source_title"],
                    "source_url":   r["source_url"],
                    "count":        int(r["count"]),
                    "voters":       list(r["voters"]),
                }
                for r in cur.fetchall()
            ]


class CommentBody(BaseModel):
    week_start: str           # YYYY-MM-DD
    insight_id: Optional[int] = None
    insight_text: str
    section: str = "Podcasts"
    comment: str


@router.post("/briefings/comment")
def post_comment(body: CommentBody, user=Depends(require_auth)):
    """Add a comment to a briefing insight. Returns the new comment row."""
    username = user.get("username", "analyst") if isinstance(user, dict) else str(user)
    week_start = date_type.fromisoformat(body.week_start[:10])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.briefing_comments
                    (week_start, insight_id, insight_text, section, comment, commented_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, comment, commented_by, created_at
            """, (week_start, body.insight_id, body.insight_text, body.section,
                  body.comment.strip(), username))
            row = dict(cur.fetchone())
            conn.commit()
    return {
        "id":           row["id"],
        "comment":      row["comment"],
        "commented_by": row["commented_by"],
        "created_at":   row["created_at"].isoformat(),
    }


@router.get("/briefings/comments/{week_start}")
def get_briefing_comments(week_start: str):
    """All comments for a briefing week, grouped by insight_text. No auth required."""
    ws = date_type.fromisoformat(week_start[:10])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, insight_text, section, comment, commented_by, created_at
                FROM cvc.briefing_comments
                WHERE week_start = %s
                ORDER BY insight_text, created_at ASC
            """, (ws,))
            rows = cur.fetchall()

    # Group by insight_text
    grouped: dict = {}
    for r in rows:
        key = r["insight_text"]
        if key not in grouped:
            grouped[key] = []
        grouped[key].append({
            "id":           r["id"],
            "comment":      r["comment"],
            "commented_by": r["commented_by"],
            "created_at":   r["created_at"].isoformat(),
        })
    return grouped


@router.get("/portfolio-pulse")
def get_portfolio_pulse(user=Depends(require_auth)):
    """
    3 most recent significant portfolio events for the Homepage sidebar widget.
    Sources: funding rounds >= $10M, late-stage changes from activity log, commercial agreements.
    """
    LATE_STAGES = ("Series A", "Series B", "Series C", "Growth", "Late Stage", "Public")
    with get_connection() as conn:
        with conn.cursor() as cur:
            events = []

            # Funding rounds >= $10M for portfolio companies (last 90 days)
            cur.execute("""
                SELECT fr.id, c.id AS company_id, c.name AS company_name,
                       fr.round_type, fr.amount_usd, fr.created_at AS event_at
                FROM cvc.funding_rounds fr
                JOIN cvc.companies c ON c.id = fr.company_id
                WHERE fr.amount_usd >= 10000000
                  AND c.is_portfolio = TRUE
                  AND fr.created_at > NOW() - INTERVAL '90 days'
                ORDER BY fr.created_at DESC
                LIMIT 5
            """)
            for r in cur.fetchall():
                amt_m = f"${int(r['amount_usd']) / 1_000_000:.0f}M"
                events.append({
                    "type":         "funding",
                    "company_id":   r["company_id"],
                    "company_name": r["company_name"],
                    "label":        f"{amt_m} {r['round_type']}",
                    "event_at":     r["event_at"].isoformat(),
                })

            # Stage changes to late-stage from activity log (last 90 days)
            placeholders = ", ".join(["%s"] * len(LATE_STAGES))
            cur.execute(f"""
                SELECT DISTINCT ON (cal.company_id)
                    cal.company_id, c.name AS company_name,
                    cal.new_value AS new_stage, cal.changed_at AS event_at
                FROM cvc.company_activity_log cal
                JOIN cvc.companies c ON c.id = cal.company_id
                WHERE cal.field_name = 'stage'
                  AND cal.new_value IN ({placeholders})
                  AND cal.changed_at > NOW() - INTERVAL '90 days'
                  AND c.is_portfolio = TRUE
                ORDER BY cal.company_id, cal.changed_at DESC
            """, list(LATE_STAGES))
            for r in cur.fetchall():
                events.append({
                    "type":         "stage_change",
                    "company_id":   r["company_id"],
                    "company_name": r["company_name"],
                    "label":        f"Stage: {r['new_stage']}",
                    "event_at":     r["event_at"].isoformat(),
                })

            # Commercial agreements for portfolio companies (last 90 days)
            cur.execute("""
                SELECT cd.id, c.id AS company_id, c.name AS company_name,
                       cd.deployment_type, cd.created_at AS event_at
                FROM cvc.commercial_deployments cd
                JOIN cvc.companies c ON c.id = cd.company_id
                WHERE c.is_portfolio = TRUE
                  AND cd.created_at > NOW() - INTERVAL '90 days'
                  AND cd.deployment_type IN ('Commercial Deployment', 'Enterprise', 'Government Contract')
                ORDER BY cd.created_at DESC
                LIMIT 5
            """)
            for r in cur.fetchall():
                events.append({
                    "type":         "commercial",
                    "company_id":   r["company_id"],
                    "company_name": r["company_name"],
                    "label":        r["deployment_type"],
                    "event_at":     r["event_at"].isoformat(),
                })

    events.sort(key=lambda e: e["event_at"], reverse=True)
    return events[:3]


@router.delete("/briefings/insights/{insight_id}")
def delete_briefing_insight(insight_id: int, user=Depends(require_auth)):
    """Remove a single insight from a weekly briefing (irrelevant item clean-up)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.briefing_insights WHERE id = %s RETURNING id",
                (insight_id,)
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Insight not found")
        conn.commit()
    return {"deleted": insight_id}
