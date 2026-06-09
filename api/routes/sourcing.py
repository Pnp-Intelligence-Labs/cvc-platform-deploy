"""
api/routes/sourcing.py — Startup sourcing endpoint with advanced filters.
"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from api.auth import require_auth
from core.db.connection import get_connection

router = APIRouter()

# Normalize legacy snake_case stage values sent by older frontend versions
_STAGE_NORM = {
    "pre_seed": "Pre-Seed", "pre-seed": "Pre-Seed",
    "seed": "Seed",
    "series_a": "Series A", "series a": "Series A",
    "series_b": "Series B", "series b": "Series B",
    "series_c": "Series C", "series c": "Series C", "series c+": "Series C",
    "series_d": "Series D+", "series d": "Series D+",
    "series_e": "Series E",
    "growth": "Growth",
    "undisclosed": "Undisclosed",
    "n/a": "Undisclosed",
}

def _norm_stage(s: str | None) -> str | None:
    if not s:
        return None
    return _STAGE_NORM.get(s.lower().strip(), s)


def _format_raised(amount: int | None) -> str | None:
    if not amount:
        return None
    if amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.1f}B"
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.1f}M"
    return f"${amount:,}"


class SourcingCompany(BaseModel):
    id: int
    name: str
    sector: str | None = None
    stage: str | None = None
    location: str | None = None
    raised: str | None = None
    one_liner: str | None = None
    description: str | None = None
    signal_score: float | None = None
    founded: int | None = None
    total_raised_usd: int | None = None
    is_hardware: bool | None = None
    is_software: bool | None = None
    subsector: str | None = None
    intro_count: int = 0
    intro_partners: list[str] = []
    last_intro_date: str | None = None
    has_case_study: bool = False
    investor_tier: str | None = None
    is_portfolio: bool | None = None
    fund: str | None = None


@router.get("/")
async def list_sourcing_companies(
    q: str | None = Query(None),
    sector: str | None = Query(None),
    stage: str | None = Query(None),
    subsector: str | None = Query(None),
    is_hardware: bool | None = Query(None),
    is_software: bool | None = Query(None),
    founded_after: int | None = Query(None),
    founded_before: int | None = Query(None),
    raised_min: int | None = Query(None),
    raised_max: int | None = Query(None),
    min_intros: int | None = Query(None, description="Minimum number of partner introductions"),
    has_case_study: bool | None = Query(None, description="Only companies with a case study"),
    investor_tier: str | None = Query(None, description="top_tier | mid_tier | emerging"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user=Depends(require_auth)
):
    """
    Advanced company sourcing with filters for funding, founding year,
    hardware/software flags, and subsector.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            conditions = []
            params = []

            # Text search across name, one_liner, description
            if q:
                conditions.append("(name ILIKE %s OR one_liner ILIKE %s OR description ILIKE %s)")
                params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

            # Sector filter
            if sector:
                conditions.append("sector = %s")
                params.append(sector)

            # Stage filter — normalise so both "series_a" and "Series A" work
            if stage:
                conditions.append("stage = %s")
                params.append(_norm_stage(stage))

            # Subsector filter
            if subsector:
                conditions.append("subsector = %s")
                params.append(subsector)

            # Hardware/software flags
            if is_hardware is not None:
                conditions.append("is_hardware = %s")
                params.append(is_hardware)

            if is_software is not None:
                conditions.append("is_software = %s")
                params.append(is_software)

            # Founded year range
            if founded_after is not None:
                conditions.append("founded >= %s")
                params.append(founded_after)

            if founded_before is not None:
                conditions.append("founded <= %s")
                params.append(founded_before)

            # Funding range
            if raised_min is not None:
                conditions.append("total_raised_usd >= %s")
                params.append(raised_min)

            if raised_max is not None:
                conditions.append("total_raised_usd <= %s")
                params.append(raised_max)

            if min_intros is not None:
                conditions.append("(SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = id) >= %s")
                params.append(min_intros)

            if has_case_study:
                conditions.append("case_study IS NOT NULL AND case_study != ''")

            if investor_tier:
                conditions.append("investor_tier = %s")
                params.append(investor_tier)

            # Build WHERE clause
            where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

            # Get total count for pagination
            count_query = f"SELECT COUNT(*) as total FROM cvc.companies {where_clause}"
            cur.execute(count_query, params)
            total = cur.fetchone()["total"]

            # Main query with all sourcing fields
            offset = (page - 1) * per_page
            if q:
                order_clause = """
                    CASE
                        WHEN name ILIKE %s THEN 0
                        WHEN name ILIKE %s THEN 1
                        ELSE 2
                    END,
                    score_composite DESC NULLS LAST, name
                """
                order_params = [f"{q}%", f"%{q}%"]
            else:
                order_clause = "score_composite DESC NULLS LAST, name"
                order_params = []

            query = f"""
                SELECT
                    id,
                    name,
                    sector,
                    stage,
                    hq_city,
                    country,
                    one_liner,
                    description,
                    score_composite as signal_score,
                    founded,
                    total_raised_usd,
                    is_hardware,
                    is_software,
                    subsector,
                    (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_count,
                    (SELECT COALESCE(ARRAY_AGG(DISTINCT pi.partner_name ORDER BY pi.partner_name), ARRAY[]::text[]) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_partners,
                    last_intro_date,
                    (case_study IS NOT NULL AND case_study != '') AS has_case_study,
                    investor_tier,
                    is_portfolio,
                    fund
                FROM cvc.companies
                {where_clause}
                ORDER BY {order_clause}
                LIMIT %s OFFSET %s
            """
            cur.execute(query, params + order_params + [per_page, offset])
            rows = cur.fetchall()

            companies = []
            for r in rows:
                city, country = r["hq_city"], r["country"]
                location = f"{city}, {country}" if city and country else city or country or None
                companies.append(SourcingCompany(
                    id=r["id"],
                    name=r["name"],
                    sector=r["sector"],
                    stage=r["stage"],
                    location=location,
                    raised=_format_raised(r["total_raised_usd"]),
                    one_liner=r["one_liner"],
                    description=r["description"],
                    signal_score=r["signal_score"],
                    founded=r["founded"],
                    total_raised_usd=r["total_raised_usd"],
                    is_hardware=r["is_hardware"],
                    is_software=r["is_software"],
                    subsector=r["subsector"],
                    intro_count=r["intro_count"] or 0,
                    intro_partners=list(r["intro_partners"]) if r["intro_partners"] else [],
                    last_intro_date=str(r["last_intro_date"]) if r["last_intro_date"] else None,
                    has_case_study=bool(r["has_case_study"]),
                    investor_tier=r["investor_tier"],
                    is_portfolio=r["is_portfolio"],
                    fund=r["fund"],
                ))

            return {
                "companies": companies,
                "total": total,
                "page": page,
                "per_page": per_page,
            }
