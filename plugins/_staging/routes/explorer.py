"""
Data Explorer — pre-built report templates for non-technical users.
Each endpoint returns { data: [...], meta: { provenance, data_quality } }
so the UI can show exactly where numbers came from and how verified they are.
All parameters are strictly whitelisted — no freeform SQL.
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from ..auth import require_auth
from core.db.connection import get_connection

router = APIRouter()

VALID_SECTORS = {
    "Robotics", "Supply Chain", "Physical AI",
    "Industrial Automation", "Manufacturing",
}

VALID_STAGES = {
    "Pre-Seed", "Seed", "Series A", "Series B",
    "Series C", "Series D+", "Growth",
}

OUTCOME_LABELS = {
    "shared":     "Shared with Partner",
    "intro_made": "Intro Made",
    "evaluation": "In Evaluation",
    "on_hold":    "On Hold",
    "completed":  "Completed",
    "closed":     "Closed / No Fit",
    "planning":   "Planning",
    "commercial": "Commercial Engagement",
    "in_progress":"In Progress",
    "cancelled":  "Cancelled",
    "monitoring": "Monitoring",
    "PoC/PoT":    "PoC / PoT",
}


def _intro_data_quality(cur, where: str, params: list) -> dict:
    """Data quality metrics for partner_intros-based reports."""
    cur.execute(f"""
        SELECT
            COUNT(*)                                             AS total,
            COUNT(*) FILTER (WHERE outcome IS NOT NULL)         AS has_outcome,
            COUNT(*) FILTER (WHERE match_reviewed = true)       AS match_reviewed
        FROM cvc.partner_intros pi
        {where}
    """, params)
    row = dict(cur.fetchone())
    total        = row["total"] or 1
    outcome_pct  = round(row["has_outcome"]    / total * 100, 1)
    reviewed_pct = round(row["match_reviewed"] / total * 100, 1)
    data_score   = round(outcome_pct * 0.5 + reviewed_pct * 0.5)
    return {
        "total_companies":  row["total"],   # reusing key name for consistency
        "human_edited_pct": reviewed_pct,   # match_reviewed = a human verified the company link
        "enriched_pct":     outcome_pct,    # outcome recorded = data completeness proxy
        "data_score":       data_score,
    }


def _company_data_quality(cur, company_where: str, params: list) -> dict:
    """
    For a set of companies matching company_where, return:
    - total_companies: count in scope
    - human_edited_pct: % with at least one manual edit in company_activity_log
    - enriched_pct: % with enrichment_status = 'complete'
    - data_score: 0-100 composite (human 60% weight, enriched 40%)
    """
    cur.execute(f"""
        SELECT
            COUNT(*)                                                        AS total,
            COUNT(*) FILTER (WHERE enrichment_status = 'complete')         AS enriched,
            COUNT(DISTINCT cal.company_id)                                  AS human_edited
        FROM cvc.companies c
        LEFT JOIN cvc.company_activity_log cal ON cal.company_id = c.id
        {company_where}
    """, params)
    row = dict(cur.fetchone())
    total = row["total"] or 1  # avoid div/0
    enriched_pct    = round(row["enriched"]      / total * 100, 1)
    human_pct       = round(row["human_edited"]  / total * 100, 1)
    data_score      = round(human_pct * 0.6 + enriched_pct * 0.4)
    return {
        "total_companies":  row["total"],
        "human_edited_pct": human_pct,
        "enriched_pct":     enriched_pct,
        "data_score":       data_score,
    }


# ── Template 1: Companies by Sector ─────────────────────────────────────────

@router.get("/sector-overview")
def sector_overview(
    stage: Optional[str] = Query(None),
    min_score: Optional[int] = Query(None, ge=0, le=100),
    _user=Depends(require_auth),
):
    with get_connection() as conn:
        cur = conn.cursor()
        filters = ["sector IS NOT NULL"]
        params: list = []

        if stage and stage in VALID_STAGES:
            filters.append("stage = %s")
            params.append(stage)
        if min_score is not None:
            filters.append("score_composite >= %s")
            params.append(min_score)

        where = "WHERE " + " AND ".join(filters)
        cur.execute(f"""
            SELECT sector,
                   COUNT(*) AS company_count,
                   COUNT(*) FILTER (WHERE is_portfolio = true) AS portfolio_count,
                   ROUND(AVG(score_composite)::numeric, 1) AS avg_score
            FROM cvc.companies
            {where}
            GROUP BY sector
            ORDER BY company_count DESC
        """, params)
        data = [dict(r) for r in cur.fetchall()]
        quality = _company_data_quality(cur, where, params)

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.companies"],
            "key_fields": {
                "company_count": "COUNT(*) — all rows matching filters",
                "avg_score":     "AVG(score_composite) — algorithmic score updated nightly by score_refresh.py",
                "portfolio_count": "COUNT(*) WHERE is_portfolio = true — manually flagged by team",
            },
            "caveats": [
                "Sector field is auto-assigned by the enrichment worker; human corrections are logged in company_activity_log.",
                "avg_score is computed, not human-reviewed. High scores indicate AI-assessed fit, not confirmed investment quality.",
                "Companies with no sector assigned are excluded from this view.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 2: Funding Trends ───────────────────────────────────────────────

@router.get("/funding-trends")
def funding_trends(
    sector: Optional[str] = Query(None),
    start_year: int = Query(2020, ge=2015, le=2030),
    end_year: int = Query(2026, ge=2015, le=2030),
    _user=Depends(require_auth),
):
    with get_connection() as conn:
        cur = conn.cursor()
        fr_filters = [
            "fr.announced_date IS NOT NULL",
            "fr.amount_usd > 0",
            "EXTRACT(YEAR FROM fr.announced_date) BETWEEN %s AND %s",
        ]
        fr_params: list = [start_year, end_year]
        co_filters = ["sector IS NOT NULL"]
        co_params: list = []

        if sector and sector in VALID_SECTORS:
            fr_filters.append("c.sector = %s")
            fr_params.append(sector)
            co_filters.append("sector = %s")
            co_params.append(sector)

        fr_where = "WHERE " + " AND ".join(fr_filters)
        cur.execute(f"""
            SELECT EXTRACT(YEAR FROM fr.announced_date)::int AS year,
                   COUNT(DISTINCT fr.company_id) AS companies_funded,
                   ROUND(SUM(fr.amount_usd) / 1e6, 1) AS total_m,
                   ROUND(AVG(fr.amount_usd) / 1e6, 1) AS avg_round_m
            FROM cvc.funding_rounds fr
            JOIN cvc.companies c ON c.id = fr.company_id
            {fr_where}
            GROUP BY year
            ORDER BY year
        """, fr_params)
        data = [dict(r) for r in cur.fetchall()]

        co_where = "WHERE " + " AND ".join(co_filters)
        quality = _company_data_quality(cur, co_where, co_params)
        # Count how many funding rounds have amounts
        cur.execute(f"""
            SELECT COUNT(*) AS total_rounds,
                   COUNT(*) FILTER (WHERE fr.amount_usd > 0) AS rounds_with_amount
            FROM cvc.funding_rounds fr
            JOIN cvc.companies c ON c.id = fr.company_id
            WHERE EXTRACT(YEAR FROM fr.announced_date) BETWEEN %s AND %s
            {'AND c.sector = %s' if sector and sector in VALID_SECTORS else ''}
        """, [start_year, end_year] + ([sector] if sector and sector in VALID_SECTORS else []))
        fr_stats = dict(cur.fetchone())

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.funding_rounds", "cvc.companies"],
            "key_fields": {
                "total_m":          "SUM(amount_usd) / 1,000,000 — from funding_rounds.amount_usd",
                "companies_funded": "COUNT DISTINCT company_id — unique companies with a tracked round that year",
                "avg_round_m":      "AVG(amount_usd) — mean round size across all rounds that year",
            },
            "caveats": [
                "Only rounds explicitly entered in the platform database are counted. Many rounds go untracked.",
                f"{fr_stats['rounds_with_amount']} of {fr_stats['total_rounds']} rounds in this range have a recorded amount.",
                "Funding amounts are sourced from public announcements via the enrichment worker; not independently verified.",
                "Years with zero bars (e.g. 2023) reflect a gap in tracked data, not necessarily a market downturn.",
                "Round types (Seed, Series A, etc.) are not distinguished in this view.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 3: Stage Distribution ──────────────────────────────────────────

@router.get("/stage-distribution")
def stage_distribution(
    sector: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    with get_connection() as conn:
        cur = conn.cursor()
        filters = ["stage IS NOT NULL"]
        params: list = []

        if sector and sector in VALID_SECTORS:
            filters.append("sector = %s")
            params.append(sector)

        where = "WHERE " + " AND ".join(filters)
        cur.execute(f"""
            SELECT stage,
                   COUNT(*) AS company_count,
                   COUNT(*) FILTER (WHERE is_portfolio = true) AS portfolio_count,
                   ROUND(AVG(score_composite)::numeric, 1) AS avg_score
            FROM cvc.companies
            {where}
            GROUP BY stage
            ORDER BY
                CASE stage
                    WHEN 'Pre-Seed'  THEN 1 WHEN 'Seed'      THEN 2
                    WHEN 'Series A'  THEN 3 WHEN 'Series B'  THEN 4
                    WHEN 'Series C'  THEN 5 WHEN 'Series D+' THEN 6
                    WHEN 'Growth'    THEN 7 ELSE 99
                END
        """, params)
        data = [dict(r) for r in cur.fetchall()]

        # Count companies with no stage assigned
        cur.execute(f"""
            SELECT COUNT(*) FROM cvc.companies
            WHERE stage IS NULL
            {'AND sector = %s' if sector and sector in VALID_SECTORS else ''}
        """, ([sector] if sector and sector in VALID_SECTORS else []))
        no_stage = cur.fetchone()[0]

        quality = _company_data_quality(cur, where, params)

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.companies"],
            "key_fields": {
                "stage":         "companies.stage — funding stage label (e.g. 'Seed', 'Series A')",
                "company_count": "COUNT(*) — companies with a known stage",
                "portfolio_count": "COUNT(*) WHERE is_portfolio = true",
            },
            "caveats": [
                f"{no_stage} companies are excluded because their stage field is NULL — they exist in the DB but have not been classified.",
                "Stage is auto-assigned by the enrichment worker based on the most recent funding round found online; it may lag real-world status.",
                "Portfolio companies have been manually reviewed; their stage assignments are most reliable.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 4: Score Distribution ──────────────────────────────────────────

@router.get("/score-distribution")
def score_distribution(
    sector: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    with get_connection() as conn:
        cur = conn.cursor()
        filters = ["score_composite IS NOT NULL"]
        params: list = []

        if sector and sector in VALID_SECTORS:
            filters.append("sector = %s")
            params.append(sector)

        where = "WHERE " + " AND ".join(filters)
        cur.execute(f"""
            SELECT (FLOOR(score_composite / 20) * 20)::int AS band_start,
                   (FLOOR(score_composite / 20) * 20 + 20)::int AS band_end,
                   COUNT(*) AS company_count,
                   COUNT(*) FILTER (WHERE is_portfolio = true) AS portfolio_count
            FROM cvc.companies
            {where}
            GROUP BY band_start, band_end
            ORDER BY band_start
        """, params)
        data = [dict(r) for r in cur.fetchall()]
        for r in data:
            r["label"] = f"{r['band_start']}–{r['band_end']}"

        cur.execute(f"""
            SELECT COUNT(*) FROM cvc.companies
            WHERE score_composite IS NULL
            {'AND sector = %s' if sector and sector in VALID_SECTORS else ''}
        """, ([sector] if sector and sector in VALID_SECTORS else []))
        no_score = cur.fetchone()[0]

        quality = _company_data_quality(cur, where, params)

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.companies"],
            "key_fields": {
                "score_composite": "Composite score 0–100 computed by score_refresh.py nightly from four sub-scores: IRS (Innovation Readiness), SRI (Strategic Relevance), TDF (Technical Depth), Commercial.",
                "band":            "Companies bucketed into 20-point ranges (0–20, 20–40, etc.)",
            },
            "caveats": [
                f"{no_score} companies have no score yet — likely newly added or awaiting enrichment.",
                "Scores are fully algorithmic. They reflect AI-assessed fit against the investment thesis, not human judgment.",
                "A high score does not mean the company has been reviewed by the team. Portfolio companies have been.",
                "Scores change nightly — a snapshot taken today may differ from one taken tomorrow.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 5: Partner Engagement Over Time ─────────────────────────────────

@router.get("/engagement-over-time")
def engagement_over_time(
    sector: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    """Total intro events per year, aggregated — no partner names exposed."""
    with get_connection() as conn:
        cur = conn.cursor()
        filters = ["pi.intro_date IS NOT NULL"]
        params: list = []

        if sector and sector in VALID_SECTORS:
            filters.append("c.sector = %s")
            params.append(sector)

        join  = "JOIN cvc.companies c ON c.id = pi.company_id" if sector and sector in VALID_SECTORS else ""
        where = "WHERE " + " AND ".join(filters)

        cur.execute(f"""
            SELECT
                EXTRACT(YEAR FROM pi.intro_date)::int AS year,
                COUNT(*)                               AS intro_events,
                COUNT(DISTINCT pi.company_id)          AS unique_companies,
                COUNT(DISTINCT pi.partner_id)          AS corporate_orgs
            FROM cvc.partner_intros pi
            {join}
            {where}
            GROUP BY year
            ORDER BY year
        """, params)
        data = [dict(r) for r in cur.fetchall()]
        quality = _intro_data_quality(cur, where.replace("pi.intro_date IS NOT NULL", "intro_date IS NOT NULL"), params[:])

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.partner_intros"],
            "key_fields": {
                "intro_events":    "COUNT(*) — all introduction events logged in the platform for that year",
                "unique_companies":"COUNT DISTINCT company_id — unique startups introduced to at least one partner",
                "corporate_orgs":  "COUNT DISTINCT partner_id — unique corporate partner organizations involved",
            },
            "caveats": [
                "Partner names and identities are intentionally aggregated — org counts represent how many distinct organizations were active, not who they are.",
                "Intro events are logged when a startup is formally introduced or shared with a partner. Informal conversations are not captured.",
                "2026 data is partial — the year is not complete.",
                "Pre-2021 data may be incomplete due to historical import gaps.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 6: Corporate Industry Activity ──────────────────────────────────

@router.get("/industry-activity")
def industry_activity(
    _user=Depends(require_auth),
):
    """Intro events grouped by corporate partner industry — no org names."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                p.industry,
                COUNT(*)                      AS intro_events,
                COUNT(DISTINCT pi.company_id) AS unique_companies,
                COUNT(DISTINCT pi.partner_id) AS org_count
            FROM cvc.partner_intros pi
            JOIN cvc.partners p ON p.id = pi.partner_id
            WHERE p.industry IS NOT NULL
            GROUP BY p.industry
            ORDER BY intro_events DESC
            LIMIT 15
        """)
        data = [dict(r) for r in cur.fetchall()]
        quality = _intro_data_quality(cur, "WHERE intro_date IS NOT NULL", [])

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.partner_intros", "cvc.partners"],
            "key_fields": {
                "industry":        "partners.industry — corporate sector classification of the engaging organization",
                "intro_events":    "COUNT(*) — total intro events from organizations in this industry",
                "unique_companies":"COUNT DISTINCT company_id — startups introduced by orgs in this industry",
                "org_count":       "COUNT DISTINCT partner_id — how many distinct organizations in this industry engaged",
            },
            "caveats": [
                "Individual partner organization names are not shown — data is aggregated to the industry level.",
                "Industry classification is manually assigned to each partner; some orgs may have null or imprecise labels.",
                "An org classified under one industry may have interests across multiple verticals.",
                "Top 15 industries by volume shown.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 7: Sector Demand Ranking ────────────────────────────────────────

@router.get("/sector-demand")
def sector_demand(
    _user=Depends(require_auth),
):
    """Which startup sectors attract the most corporate partner interest?"""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                c.sector,
                COUNT(*)                      AS intro_events,
                COUNT(DISTINCT pi.company_id) AS unique_companies,
                COUNT(DISTINCT pi.partner_id) AS corporate_orgs
            FROM cvc.partner_intros pi
            JOIN cvc.companies c ON c.id = pi.company_id
            WHERE c.sector IS NOT NULL
              AND c.sector NOT IN ('Other', 'Defense')
            GROUP BY c.sector
            ORDER BY intro_events DESC
        """)
        data = [dict(r) for r in cur.fetchall()]
        quality = _intro_data_quality(cur, "WHERE intro_date IS NOT NULL", [])

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.partner_intros", "cvc.companies"],
            "key_fields": {
                "sector":          "companies.sector — startup's focus sector",
                "intro_events":    "COUNT(*) — total times a company in this sector was introduced to a partner",
                "unique_companies":"COUNT DISTINCT — distinct startups in the sector that received at least one intro",
                "corporate_orgs":  "COUNT DISTINCT partner_id — how many partner orgs engaged with this sector",
            },
            "caveats": [
                "Sector is auto-assigned to the startup by the enrichment worker; occasional misclassifications exist.",
                "'Other' and 'Defense' sectors excluded — small sample sizes with inconsistent classification.",
                "A single startup introduced to 5 partners counts as 5 intro events — high-volume sectors may reflect a small number of popular companies.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 8: Intro Outcome Distribution ───────────────────────────────────

@router.get("/intro-outcomes")
def intro_outcomes(
    sector: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    """How do partner introductions resolve? Outcome distribution across all intros."""
    with get_connection() as conn:
        cur = conn.cursor()
        filters: list = []
        params: list  = []

        if sector and sector in VALID_SECTORS:
            filters.append("c.sector = %s")
            params.append(sector)

        join  = "JOIN cvc.companies c ON c.id = pi.company_id" if filters else ""
        where = ("WHERE " + " AND ".join(filters)) if filters else ""

        cur.execute(f"""
            SELECT
                COALESCE(pi.outcome, 'no_outcome') AS outcome,
                COUNT(*) AS count
            FROM cvc.partner_intros pi
            {join}
            {where}
            GROUP BY outcome
            ORDER BY count DESC
        """, params)
        rows = [dict(r) for r in cur.fetchall()]
        # Apply human-readable labels
        for r in rows:
            r["label"] = OUTCOME_LABELS.get(r["outcome"], r["outcome"].replace("_", " ").title())

        quality_where = "WHERE intro_date IS NOT NULL" + (f" AND pi.company_id IN (SELECT id FROM cvc.companies WHERE sector = %s)" if sector and sector in VALID_SECTORS else "")
        quality = _intro_data_quality(cur, quality_where, ([sector] if sector and sector in VALID_SECTORS else []))

    return {
        "data": rows,
        "meta": {
            "source_tables": ["cvc.partner_intros"],
            "key_fields": {
                "outcome": "partner_intros.outcome — status label recorded by the PSM or import process",
                "count":   "COUNT(*) — number of intro events at this outcome stage",
            },
            "caveats": [
                "'no_outcome' indicates records where the outcome field was never updated — common in older or bulk-imported data.",
                "Outcome labels are set manually by PSMs or imported from historical records; consistency varies across time periods.",
                "'Closed / No Fit' does not mean the startup is low quality — it means the fit with that specific partner was not pursued.",
                "Outcomes are not mutually exclusive over time — a record may have been updated from 'Shared' to 'Evaluation'.",
            ],
            "data_quality": quality,
        },
    }
