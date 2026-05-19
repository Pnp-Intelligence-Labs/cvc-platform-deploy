"""
Data Explorer plugin — pre-built analytical report templates.

Each endpoint returns { data: [...], meta: { provenance, data_quality } }
so the UI can show exactly where numbers came from and how verified they are.
All SQL parameters are strictly parameterized — no freeform SQL injection possible.

Routes mount at /explore/* (declared in manifest.json).
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from api.auth import require_auth
from core.db.connection import get_connection

router = APIRouter()

VALID_STAGES = {
    "Pre-Seed", "Seed", "Series A", "Series B",
    "Series C", "Series D+", "Growth",
}

OUTCOME_LABELS = {
    "shared":      "Shared with Partner",
    "intro_made":  "Intro Made",
    "evaluation":  "In Evaluation",
    "on_hold":     "On Hold",
    "completed":   "Completed",
    "closed":      "Closed / No Fit",
    "planning":    "Planning",
    "commercial":  "Commercial Engagement",
    "in_progress": "In Progress",
    "cancelled":   "Cancelled",
    "monitoring":  "Monitoring",
    "PoC/PoT":     "PoC / PoT",
}


def _safe_sector(sector: Optional[str]) -> Optional[str]:
    """Return a clean sector string or None. Any non-empty string is accepted —
    SQL injection is prevented by parameterized queries, not by allowlisting."""
    if not sector:
        return None
    cleaned = sector.strip()
    return cleaned if cleaned else None


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
        "total_companies":  row["total"],
        "human_edited_pct": reviewed_pct,
        "enriched_pct":     outcome_pct,
        "data_score":       data_score,
    }


def _company_data_quality(cur, company_where: str, params: list) -> dict:
    """Data quality composite for a filtered set of companies."""
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
    total        = row["total"] or 1
    enriched_pct = round(row["enriched"]     / total * 100, 1)
    human_pct    = round(row["human_edited"] / total * 100, 1)
    data_score   = round(human_pct * 0.6 + enriched_pct * 0.4)
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
                "company_count":   "COUNT(*) — all rows matching filters",
                "avg_score":       "AVG(score_composite) — algorithmic score updated nightly",
                "portfolio_count": "COUNT(*) WHERE is_portfolio = true — manually flagged by team",
            },
            "caveats": [
                "Sector field is auto-assigned by the enrichment worker; human corrections are logged in company_activity_log.",
                "avg_score is computed, not human-reviewed.",
                "Companies with no sector assigned are excluded from this view.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 2: Funding Trends ───────────────────────────────────────────────

@router.get("/funding-trends")
def funding_trends(
    sector: Optional[str] = Query(None),
    start_year: int = Query(2020, ge=2015, le=2035),
    end_year: int = Query(2026, ge=2015, le=2035),
    _user=Depends(require_auth),
):
    safe_sector = _safe_sector(sector)

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

        if safe_sector:
            fr_filters.append("c.sector = %s")
            fr_params.append(safe_sector)
            co_filters.append("sector = %s")
            co_params.append(safe_sector)

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

        cur.execute(f"""
            SELECT COUNT(*) AS total_rounds,
                   COUNT(*) FILTER (WHERE fr.amount_usd > 0) AS rounds_with_amount
            FROM cvc.funding_rounds fr
            JOIN cvc.companies c ON c.id = fr.company_id
            WHERE EXTRACT(YEAR FROM fr.announced_date) BETWEEN %s AND %s
            {'AND c.sector = %s' if safe_sector else ''}
        """, [start_year, end_year] + ([safe_sector] if safe_sector else []))
        fr_stats = dict(cur.fetchone())

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.funding_rounds", "cvc.companies"],
            "key_fields": {
                "total_m":          "SUM(amount_usd) / 1,000,000",
                "companies_funded": "COUNT DISTINCT company_id — unique companies with a tracked round that year",
                "avg_round_m":      "AVG(amount_usd) — mean round size",
            },
            "caveats": [
                "Only rounds explicitly entered in the platform database are counted.",
                f"{fr_stats['rounds_with_amount']} of {fr_stats['total_rounds']} rounds in this range have a recorded amount.",
                "Funding amounts are sourced from public announcements; not independently verified.",
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
    safe_sector = _safe_sector(sector)

    with get_connection() as conn:
        cur = conn.cursor()
        filters = ["stage IS NOT NULL"]
        params: list = []

        if safe_sector:
            filters.append("sector = %s")
            params.append(safe_sector)

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

        cur.execute(f"""
            SELECT COUNT(*) FROM cvc.companies
            WHERE stage IS NULL
            {'AND sector = %s' if safe_sector else ''}
        """, ([safe_sector] if safe_sector else []))
        no_stage = cur.fetchone()[0]

        quality = _company_data_quality(cur, where, params)

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.companies"],
            "key_fields": {
                "stage":           "companies.stage — funding stage label",
                "company_count":   "COUNT(*) — companies with a known stage",
                "portfolio_count": "COUNT(*) WHERE is_portfolio = true",
            },
            "caveats": [
                f"{no_stage} companies are excluded because their stage field is NULL.",
                "Stage is auto-assigned by the enrichment worker; it may lag real-world status.",
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
    safe_sector = _safe_sector(sector)

    with get_connection() as conn:
        cur = conn.cursor()
        filters = ["score_composite IS NOT NULL"]
        params: list = []

        if safe_sector:
            filters.append("sector = %s")
            params.append(safe_sector)

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
            {'AND sector = %s' if safe_sector else ''}
        """, ([safe_sector] if safe_sector else []))
        no_score = cur.fetchone()[0]

        quality = _company_data_quality(cur, where, params)

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.companies"],
            "key_fields": {
                "score_composite": "Composite score 0–100 computed nightly from four sub-scores (IRS, SRI, TDF, Commercial).",
                "band":            "Companies bucketed into 20-point ranges (0–20, 20–40, etc.)",
            },
            "caveats": [
                f"{no_score} companies have no score yet — likely newly added or awaiting enrichment.",
                "Scores are fully algorithmic — they reflect AI-assessed fit, not human judgment.",
                "Scores change nightly.",
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
    """Total intro events per year. No partner names exposed."""
    safe_sector = _safe_sector(sector)

    with get_connection() as conn:
        cur = conn.cursor()
        filters = ["pi.intro_date IS NOT NULL"]
        params: list = []

        if safe_sector:
            filters.append("c.sector = %s")
            params.append(safe_sector)

        join  = "JOIN cvc.companies c ON c.id = pi.company_id" if safe_sector else ""
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
        quality = _intro_data_quality(cur, "WHERE intro_date IS NOT NULL", [])

    return {
        "data": data,
        "meta": {
            "source_tables": ["cvc.partner_intros"],
            "key_fields": {
                "intro_events":     "COUNT(*) — all introduction events logged for that year",
                "unique_companies": "COUNT DISTINCT company_id — unique startups introduced",
                "corporate_orgs":   "COUNT DISTINCT partner_id — distinct partner organizations involved",
            },
            "caveats": [
                "Partner names are intentionally aggregated — org counts only, no identities exposed.",
                "Intro events are logged when formally introduced or shared with a partner.",
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
    """Intro events grouped by corporate partner industry. No org names."""
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
                "industry":         "partners.industry — corporate sector classification",
                "intro_events":     "COUNT(*) — total intro events from orgs in this industry",
                "unique_companies": "COUNT DISTINCT company_id — startups introduced",
                "org_count":        "COUNT DISTINCT partner_id — distinct orgs in this industry",
            },
            "caveats": [
                "Individual organization names are not shown — aggregated to industry level.",
                "Industry classification is manually assigned; some orgs may have null or imprecise labels.",
                "Top 15 industries by volume shown.",
            ],
            "data_quality": quality,
        },
    }


# ── Template 7: Sector Demand Ranking ────────────────────────────────────────

@router.get("/sector-demand")
def sector_demand(
    exclude_other: bool = Query(True),
    _user=Depends(require_auth),
):
    """Which startup sectors attract the most corporate partner interest?"""
    with get_connection() as conn:
        cur = conn.cursor()
        where = "WHERE c.sector IS NOT NULL"
        if exclude_other:
            where += " AND c.sector != 'Other'"

        cur.execute(f"""
            SELECT
                c.sector,
                COUNT(*)                      AS intro_events,
                COUNT(DISTINCT pi.company_id) AS unique_companies,
                COUNT(DISTINCT pi.partner_id) AS corporate_orgs
            FROM cvc.partner_intros pi
            JOIN cvc.companies c ON c.id = pi.company_id
            {where}
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
                "sector":           "companies.sector — startup's focus area",
                "intro_events":     "COUNT(*) — total times a company in this sector was introduced",
                "unique_companies": "COUNT DISTINCT — distinct startups with at least one intro",
                "corporate_orgs":   "COUNT DISTINCT partner_id — partner orgs that engaged with this sector",
            },
            "caveats": [
                "Sector is auto-assigned by the enrichment worker; occasional misclassifications exist.",
                "'Other' sector excluded by default (use ?exclude_other=false to include).",
                "A single startup introduced to multiple partners counts as multiple intro events.",
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
    safe_sector = _safe_sector(sector)

    with get_connection() as conn:
        cur = conn.cursor()
        filters: list = []
        params: list  = []

        if safe_sector:
            filters.append("c.sector = %s")
            params.append(safe_sector)

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
        for r in rows:
            r["label"] = OUTCOME_LABELS.get(r["outcome"], r["outcome"].replace("_", " ").title())

        quality_where = (
            "WHERE intro_date IS NOT NULL"
            + (f" AND pi.company_id IN (SELECT id FROM cvc.companies WHERE sector = %s)" if safe_sector else "")
        )
        quality = _intro_data_quality(cur, quality_where, ([safe_sector] if safe_sector else []))

    return {
        "data": rows,
        "meta": {
            "source_tables": ["cvc.partner_intros"],
            "key_fields": {
                "outcome": "partner_intros.outcome — status label set by PSM or import",
                "count":   "COUNT(*) — number of intro events at this outcome stage",
            },
            "caveats": [
                "'no_outcome' indicates records where the outcome field was never updated.",
                "Outcomes are set manually; consistency varies across time periods.",
                "'Closed / No Fit' does not mean the startup is low quality — it means the fit with that specific partner was not pursued.",
            ],
            "data_quality": quality,
        },
    }
